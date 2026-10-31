import * as DateTime from 'effect/DateTime'
import type * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'

import type { HarkFailure } from '@crook/protocol/Hark'

import {
  type ActivityAttempt,
  type ActivityStep,
  type FollowedHerd,
  type LiveActivityRecord,
  activityAfterForgotten,
  activityAfterOffline,
  activityAfterPublish,
  activityStartKey,
  attemptOf,
  followedHerdFrom,
  nextActivityStep,
  recordAfter,
  recordWithoutActivity,
  wakeWithin,
} from '@crook/hub/ActivityPlan'
import { logStorageFailure } from '@crook/hub/Database'
import {
  type AfterHarkFailure,
  type HarkActivityGone,
  HarkClient,
  PAUSE_AFTER_HUB_BUG,
  gaveUpOnBug,
  pauseOrGiveUp,
  pausedOnBug,
} from '@crook/hub/HarkClient'
import { HarkNotifier } from '@crook/hub/HarkNotifier'
import { type HerdChange, Herd } from '@crook/hub/Herd'
import { NotificationStore } from '@crook/hub/NotificationStore'

type ActivityOutcome = 'done' | 'gone' | AfterHarkFailure

const make = Effect.gen(function* () {
  const hark = yield* HarkClient
  const herd = yield* Herd
  const notifier = yield* HarkNotifier
  const store = yield* NotificationStore

  if (hark.delivery !== 'ready') {
    return
  }

  const record = yield* Ref.make(yield* store.liveActivity)
  const followed = yield* Ref.make(followedHerdFrom(yield* DateTime.now))
  const enabled = yield* Ref.make((yield* store.prefs).liveActivity)
  const abandonedAttempt = yield* Ref.make(Option.none<ActivityAttempt>())
  const wake = yield* Queue.sliding<void>(1)
  const changes = yield* herd.subscribeChanges

  const followHerd = (change: HerdChange) =>
    DateTime.now.pipe(
      Effect.flatMap((now) =>
        Ref.update(followed, (current) =>
          Match.value(change).pipe(
            Match.tagsExhaustive({
              MachinePublished: (published) => activityAfterPublish(current, published, now),
              PaneSeen: () => current,
              MachineForgotten: (forgotten) =>
                activityAfterForgotten(current, forgotten.machine, now),
              MachineWentOffline: (offline) => activityAfterOffline(current, offline.machine, now),
            }),
          ),
        ),
      ),
      Effect.andThen(Queue.offer(wake, undefined)),
      Effect.catchDefect((defect) =>
        Effect.logError(gaveUpOnBug('a change in the herd for the Live Activity'), defect),
      ),
    )

  const remember = (next: Option.Option<LiveActivityRecord>) =>
    Ref.set(record, next).pipe(
      Effect.andThen(
        Option.match(next, { onNone: () => Effect.void, onSome: store.rememberLiveActivity }),
      ),
      Effect.catchTag('SqlError', logStorageFailure("the herd's Live Activity")),
    )

  const outcomeOf = Effect.fn('HerdActivity.outcomeOf')(function* (
    what: string,
    attempt: Effect.Effect<void, HarkFailure | HarkActivityGone>,
  ) {
    return yield* attempt.pipe(
      Effect.as<ActivityOutcome>('done'),
      Effect.catchTag('HarkActivityGone', (gone) =>
        Effect.logInfo(gone.message).pipe(Effect.as<ActivityOutcome>('gone')),
      ),
      Effect.catch((failure) => pauseOrGiveUp(what, failure)),
    )
  })

  const act = (step: ActivityStep, call: Effect.Effect<void, HarkFailure | HarkActivityGone>) =>
    Option.match(attemptOf(step), {
      onNone: () => Effect.void,
      onSome: (attempt) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now
          const outcome = yield* outcomeOf(`the herd's Live Activity (${attempt})`, call)
          const current = yield* Ref.get(record)

          yield* Match.value(outcome).pipe(
            Match.when('done', () =>
              Ref.set(abandonedAttempt, Option.none()).pipe(
                Effect.andThen(remember(recordAfter(step, current, now))),
              ),
            ),
            Match.when('gone', () => remember(recordWithoutActivity(current))),
            Match.when('retry', () => Effect.void),
            Match.when('gaveUp', () => Ref.set(abandonedAttempt, Option.some(attempt))),
            Match.exhaustive,
          )
        }),
    })

  const awaitWake = (atMost: Option.Option<Duration.Duration>) =>
    Option.match(atMost, {
      onNone: () => Queue.take(wake),
      onSome: (duration) => Effect.raceFirst(Effect.sleep(duration), Queue.take(wake)),
    })

  const take = (
    step: ActivityStep,
    current: Option.Option<LiveActivityRecord>,
    herdNow: FollowedHerd,
    now: DateTime.Utc,
  ): Effect.Effect<void> =>
    Match.value(step).pipe(
      Match.tagsExhaustive({
        Start: (start) =>
          act(step, hark.startActivity(start.content, activityStartKey(current, start.content))),
        Update: (update) => act(step, hark.updateActivity(update.content)),
        End: (end) => act(step, hark.endActivity(end.content, end.linger)),
        Wait: (wait) =>
          Option.match(wait.atMost, {
            onNone: () => Ref.set(abandonedAttempt, Option.none()),
            onSome: () => Effect.void,
          }).pipe(Effect.andThen(awaitWake(wakeWithin(herdNow, now, wait.atMost)))),
      }),
    )

  const stepOnce = Effect.gen(function* () {
    const now = yield* DateTime.now
    const herdNow = yield* Ref.get(followed)
    const current = yield* Ref.get(record)
    const step = nextActivityStep({
      followed: herdNow,
      enabled: yield* Ref.get(enabled),
      record: current,
      now,
    })
    const abandoned = yield* Ref.get(abandonedAttempt)
    const isAbandoned = Option.exists(attemptOf(step), (attempt) =>
      Option.contains(abandoned, attempt),
    )
    yield* isAbandoned
      ? awaitWake(wakeWithin(herdNow, now, Option.none()))
      : take(step, current, herdNow, now)
  }).pipe(
    Effect.catchDefect((defect) =>
      Effect.logError(pausedOnBug('Live Activity'), defect).pipe(
        Effect.andThen(Effect.sleep(PAUSE_AFTER_HUB_BUG)),
      ),
    ),
  )

  yield* changes.pipe(Stream.runForEach(followHerd), Effect.forkScoped)
  yield* notifier.settings.pipe(
    Stream.runForEach((settings) =>
      Ref.set(enabled, settings.prefs.liveActivity).pipe(
        Effect.andThen(Queue.offer(wake, undefined)),
      ),
    ),
    Effect.forkScoped,
  )
  yield* Effect.forkScoped(Effect.forever(stepOnce))
})

export const layer = Layer.effectDiscard(make)
