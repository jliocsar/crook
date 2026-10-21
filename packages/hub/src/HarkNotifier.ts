import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import type { SqlError } from 'effect/sql/SqlError'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { isSameSeenMark } from '@crook/domain/AgentRow'
import { type NotificationEvent, NotificationSettings, withPref } from '@crook/domain/Notifications'
import {
  type HarkFailure,
  HarkReachedNoDevice,
  type TestNotificationFailure,
} from '@crook/protocol/Hark'

import { logStorageFailure } from '@crook/hub/Database'
import {
  HARK_REQUEST_SPACING,
  HarkClient,
  HarkNotification,
  type HarkNotificationId,
} from '@crook/hub/HarkClient'
import { type HerdChange, Herd } from '@crook/hub/Herd'
import {
  type NotificationStep,
  type NotificationsByPane,
  SentNotification,
  type WantedNotification,
  afterForgotten,
  afterPublish,
  afterSeen,
  idempotencyKeyOf,
  identityOf,
  isSameNotification,
  nextStep,
  notificationKey,
} from '@crook/hub/NotificationPlan'
import { NotificationStore } from '@crook/hub/NotificationStore'
import { type SeenRecord, SeenTracker } from '@crook/hub/SeenTracker'

const HARK_OUTAGE_PAUSE = Duration.seconds(60)
const PAUSE_AFTER_HUB_BUG = HARK_REQUEST_SPACING

const TEST_NOTIFICATION = new HarkNotification({
  title: 'crook',
  body: 'Test · notifications from crook arrive like this',
  idempotencyKey: Option.none(),
})

const pauseFor = (failure: HarkFailure): Option.Option<Duration.Duration> =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      HarkUnreachable: () => Option.some(HARK_OUTAGE_PAUSE),
      HarkServerFailed: () => Option.some(HARK_OUTAGE_PAUSE),
      HarkStillProcessing: () => Option.some(Duration.zero),
      HarkRateLimited: (limited) =>
        Option.map(limited.retryAfterSeconds, (seconds) => Duration.seconds(seconds)),
      HarkRefused: () => Option.none(),
      HarkAnswerUnreadable: () => Option.none(),
      HarkNotConfigured: () => Option.none(),
    }),
  )

const byPane = <Notification extends WantedNotification>(
  notifications: readonly Notification[],
): NotificationsByPane<Notification> =>
  HashMap.fromIterable(
    Arr.map(notifications, (notification) => [notificationKey(notification), notification]),
  )

const isSeenIn = (marks: readonly SeenRecord[]) => (notification: WantedNotification) =>
  Arr.some(
    marks,
    (mark) =>
      mark.machine === notification.machine &&
      mark.pane === notification.pane &&
      isSameSeenMark(mark, notification),
  )

const gaveUpOnBug = (what: string) => `The hub gave up on ${what} because of a bug in the hub.`

const make = Effect.gen(function* () {
  const hark = yield* HarkClient
  const store = yield* NotificationStore
  const herd = yield* Herd
  const seenTracker = yield* SeenTracker
  const prefs = yield* SubscriptionRef.make(yield* store.prefs)
  const sentAtStart = yield* store.sent
  const isSeenAtStart = isSeenIn(yield* seenTracker.all)
  const stillWantedAtStart = yield* Effect.filter(sentAtStart, (notification) =>
    isSeenAtStart(notification)
      ? Effect.succeed(false)
      : Effect.isSuccess(herd.requireMachine(notification.machine)),
  )
  const sent = yield* Ref.make(byPane(sentAtStart))
  const wanted = yield* SubscriptionRef.make<NotificationsByPane<WantedNotification>>(
    byPane(stillWantedAtStart),
  )
  const abandoned = yield* Ref.make(HashSet.empty<string>())

  const followHerd = (change: HerdChange) =>
    SubscriptionRef.update(wanted, (notifications) =>
      Match.value(change).pipe(
        Match.tagsExhaustive({
          MachinePublished: (published) => afterPublish(notifications, published),
          PaneSeen: (seen) => afterSeen(notifications, seen.machine, seen.pane),
          MachineForgotten: (forgotten) => afterForgotten(notifications, forgotten.machine),
        }),
      ),
    ).pipe(
      Effect.catchDefect((defect) => Effect.logError(gaveUpOnBug('a change in the herd'), defect)),
    )

  const pauseOrAbandon = (what: string, failure: HarkFailure, abandon: Effect.Effect<void>) =>
    Option.match(pauseFor(failure), {
      onNone: () =>
        Effect.logError(`The hub gave up on ${what}: ${failure.message}`).pipe(
          Effect.andThen(abandon),
        ),
      onSome: (pause) =>
        Effect.logWarning(
          `The hub retries ${what} in ${Duration.format(pause)}: ${failure.message}`,
        ).pipe(Effect.andThen(Effect.sleep(pause))),
    })

  const rememberSent = (notification: WantedNotification, harkId: HarkNotificationId) => {
    const record = new SentNotification({
      machine: notification.machine,
      pane: notification.pane,
      event: notification.event,
      terminal: notification.terminal,
      stateChangeSeq: notification.stateChangeSeq,
      title: notification.title,
      body: notification.body,
      harkId,
    })

    return Ref.update(sent, HashMap.set(notificationKey(record), record)).pipe(
      Effect.andThen(store.rememberSent(record)),
      Effect.catchTag(
        'SqlError',
        logStorageFailure(`the Hark notification of pane ${notification.pane}`),
      ),
    )
  }

  const send = Effect.fn('HarkNotifier.send')(function* (notification: WantedNotification) {
    const what = `notifying pane ${notification.pane} of machine ${notification.machine}`
    const abandon = Ref.update(abandoned, HashSet.add(identityOf(notification)))

    return yield* hark
      .send(
        new HarkNotification({
          title: notification.title,
          body: notification.body,
          idempotencyKey: idempotencyKeyOf(notification),
        }),
      )
      .pipe(
        Effect.flatMap((created) => rememberSent(notification, created.id)),
        Effect.uninterruptible,
        Effect.catch((failure) => pauseOrAbandon(what, failure, abandon)),
        Effect.catchDefect((defect) =>
          Effect.andThen(Effect.logError(gaveUpOnBug(what), defect), abandon),
        ),
      )
  })

  const forgetSent = (notification: SentNotification) =>
    Ref.update(sent, HashMap.remove(notificationKey(notification))).pipe(
      Effect.andThen(store.forgetSent(notification.machine, notification.pane)),
      Effect.catchTag(
        'SqlError',
        logStorageFailure(`the withdrawal of pane ${notification.pane}'s Hark notification`),
      ),
    )

  const withdraw = Effect.fn('HarkNotifier.withdraw')(function* (notification: SentNotification) {
    const what = `withdrawing the notification of pane ${notification.pane} of machine ${notification.machine}`

    return yield* hark.withdraw(notification.harkId).pipe(
      Effect.andThen(forgetSent(notification)),
      Effect.catch((failure) => pauseOrAbandon(what, failure, forgetSent(notification))),
      Effect.catchDefect((defect) =>
        Effect.andThen(Effect.logError(gaveUpOnBug(what), defect), forgetSent(notification)),
      ),
    )
  })

  const drop = (dropped: WantedNotification) =>
    SubscriptionRef.update(wanted, (notifications) =>
      Option.exists(HashMap.get(notifications, notificationKey(dropped)), (current) =>
        isSameNotification(current, dropped),
      )
        ? HashMap.remove(notifications, notificationKey(dropped))
        : notifications,
    )

  const take = (step: NotificationStep) =>
    Match.value(step).pipe(
      Match.tagsExhaustive({
        Withdraw: (withdrawal) => withdraw(withdrawal.sent),
        Send: (sending) => send(sending.wanted),
        Drop: (dropping) => drop(dropping.wanted),
      }),
    )

  const pruneAbandoned = Effect.flatMap(SubscriptionRef.get(wanted), (notifications) =>
    Ref.update(abandoned, (identities) =>
      HashSet.filter(identities, (identity) =>
        Arr.some(
          HashMap.toValues(notifications),
          (notification) => identityOf(notification) === identity,
        ),
      ),
    ),
  )

  const stepOnce = Effect.gen(function* () {
    yield* pruneAbandoned

    const step = nextStep(
      yield* SubscriptionRef.get(wanted),
      yield* Ref.get(sent),
      yield* Ref.get(abandoned),
      yield* SubscriptionRef.get(prefs),
    )

    yield* Option.match(step, { onNone: () => Effect.void, onSome: take })

    return Option.isSome(step)
  }).pipe(
    Effect.catchDefect((defect) =>
      Effect.logError(
        `The hub's notifier hit a bug and pauses ${Duration.format(PAUSE_AFTER_HUB_BUG)} before its next step.`,
        defect,
      ).pipe(Effect.andThen(Effect.sleep(PAUSE_AFTER_HUB_BUG)), Effect.as(true)),
    ),
  )

  const reconcile = Effect.repeat(stepOnce, { while: (stepped) => stepped })

  if (hark.delivery === 'ready') {
    const changes = yield* herd.subscribeChanges

    yield* changes.pipe(Stream.runForEach(followHerd), Effect.forkScoped)
    yield* SubscriptionRef.changes(wanted).pipe(
      Stream.buffer({ capacity: 1, strategy: 'sliding' }),
      Stream.runForEach(() => reconcile),
      Effect.forkScoped,
    )
  }

  const setPref = Effect.fn('HarkNotifier.setPref')(function* (
    event: NotificationEvent,
    enabled: boolean,
  ) {
    yield* SubscriptionRef.updateEffect(prefs, (current) =>
      Effect.as(store.setPref(event, enabled), withPref(current, event, enabled)),
    )
  })

  const sendTest = hark.send(TEST_NOTIFICATION).pipe(
    Effect.flatMap((created) =>
      created.accepted === 0 ? Effect.fail(new HarkReachedNoDevice()) : Effect.void,
    ),
    Effect.withSpan('HarkNotifier.sendTest'),
  )

  return HarkNotifier.of({
    settings: SubscriptionRef.changes(prefs).pipe(
      Stream.buffer({ capacity: 1, strategy: 'sliding' }),
      Stream.map(
        (current) => new NotificationSettings({ prefs: current, delivery: hark.delivery }),
      ),
    ),
    setPref,
    sendTest,
  })
})

export class HarkNotifier extends Context.Service<
  HarkNotifier,
  {
    readonly settings: Stream.Stream<NotificationSettings>
    readonly setPref: (event: NotificationEvent, enabled: boolean) => Effect.Effect<void, SqlError>
    readonly sendTest: Effect.Effect<void, TestNotificationFailure>
  }
>()('@crook/hub/HarkNotifier') {
  static readonly layerWithoutDependencies = Layer.effect(this, make)

  static readonly layer = this.layerWithoutDependencies.pipe(
    Layer.provide([HarkClient.layer, NotificationStore.layer, SeenTracker.layer]),
  )
}
