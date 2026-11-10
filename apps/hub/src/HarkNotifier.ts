import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import type { SqlError } from 'effect/sql/SqlError'
import * as Stream from 'effect/Stream'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { isSameSeenMark } from '@crook/domain/AgentRow'
import { type NotificationEvent, NotificationSettings, withPref } from '@crook/domain/Notifications'
import {
  type HarkFailure,
  HarkReachedNoDevice,
  harkFailureForTheLog,
  type TestNotificationFailure,
} from '@crook/protocol/Hark'

import { makeApprovalAnswers } from '@crook/hub/ApprovalAnswers'
import { logStorageFailure } from '@crook/hub/Database'
import {
  HARK_PROMPT_LIMIT,
  HarkApproval,
  HarkClient,
  type HarkId,
  HarkNotification,
  PAUSE_AFTER_HUB_BUG,
  gaveUpOnBug,
  pauseOrGiveUp,
  pausedOnBug,
} from '@crook/hub/HarkClient'
import { type HerdChange, Herd } from '@crook/hub/Herd'
import { HerdStore, type SeenRecord } from '@crook/hub/HerdStore'
import {
  type NotificationStep,
  type NotificationsByPane,
  SentNotification,
  type WantedNotification,
  afterForgotten,
  afterPublish,
  afterSeen,
  cutForHark,
  idempotencyKeyOf,
  identityOf,
  isApproval,
  isSameNotification,
  nextStep,
  notificationKey,
} from '@crook/hub/NotificationPlan'
import { NotificationStore } from '@crook/hub/NotificationStore'

const TEST_NOTIFICATION = new HarkNotification({
  title: 'crook',
  body: 'Test · notifications from crook arrive like this',
  idempotencyKey: Option.none(),
})

const byPane = <Notification extends WantedNotification>(
  notifications: readonly Notification[],
): NotificationsByPane<Notification> =>
  HashMap.fromIterable(
    Arr.map(notifications, (notification) => [notificationKey(notification), notification]),
  )

const isSeenIn = (marks: readonly SeenRecord[]) => (notification: WantedNotification) =>
  !isApproval(notification) &&
  Arr.some(
    marks,
    (mark) =>
      mark.machine === notification.machine &&
      mark.pane === notification.pane &&
      isSameSeenMark(mark, notification),
  )

const approvalOf = (notification: WantedNotification) =>
  new HarkApproval({
    title: notification.title,
    prompt: cutForHark(notification.body, HARK_PROMPT_LIMIT),
    idempotencyKey: idempotencyKeyOf(notification),
  })

const plainNotificationOf = (notification: WantedNotification) =>
  new HarkNotification({
    title: notification.title,
    body: notification.body,
    idempotencyKey: idempotencyKeyOf(notification),
  })

const make = Effect.gen(function* () {
  const hark = yield* HarkClient
  const store = yield* NotificationStore
  const herd = yield* Herd
  const herdStore = yield* HerdStore
  const prefs = yield* SubscriptionRef.make(yield* store.prefs)
  const sentAtStart = yield* store.sent
  const isSeenAtStart = isSeenIn(yield* herdStore.seenMarks)
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
  const approvals = yield* makeApprovalAnswers

  const followHerd = (change: HerdChange) =>
    SubscriptionRef.update(wanted, (notifications) =>
      Match.value(change).pipe(
        Match.tagsExhaustive({
          MachinePublished: (published) => afterPublish(notifications, published),
          PaneSeen: (seen) => afterSeen(notifications, seen.machine, seen.pane),
          MachineForgotten: (forgotten) => afterForgotten(notifications, forgotten.machine),
          MachineWentOffline: () => notifications,
        }),
      ),
    ).pipe(
      Effect.catchDefect((defect) => Effect.logError(gaveUpOnBug('a change in the herd'), defect)),
    )

  const pauseOrAbandon = (what: string, failure: HarkFailure, abandon: Effect.Effect<void>) =>
    Effect.flatMap(pauseOrGiveUp(what, failure), (outcome) =>
      outcome === 'gaveUp' ? abandon : Effect.void,
    )

  const rememberSent = (notification: WantedNotification, harkId: HarkId) => {
    const record = new SentNotification({ ...Struct.evolve(notification, {}), harkId })

    return Ref.update(sent, HashMap.set(notificationKey(record), record)).pipe(
      Effect.andThen(store.rememberSent(record)),
      Effect.catchTag(
        'SqlError',
        logStorageFailure(`the Hark notification of pane ${notification.pane}`),
      ),
      Effect.andThen(isApproval(record) ? approvals.watch(record) : Effect.void),
    )
  }

  const delivered = (notification: WantedNotification) =>
    isApproval(notification)
      ? hark.ask(approvalOf(notification))
      : Effect.map(hark.send(plainNotificationOf(notification)), (created) => created.id)

  const send = Effect.fn('HarkNotifier.send')(function* (notification: WantedNotification) {
    const what = `notifying pane ${notification.pane} of machine ${notification.machine}`
    const abandon = Ref.update(abandoned, HashSet.add(identityOf(notification)))

    return yield* delivered(notification).pipe(
      Effect.flatMap((harkId) => rememberSent(notification, harkId)),
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

  const retracted = (notification: SentNotification) =>
    isApproval(notification) ? approvals.cancel(notification) : hark.withdraw(notification.harkId)

  const withdraw = Effect.fn('HarkNotifier.withdraw')(function* (notification: SentNotification) {
    const what = `withdrawing the notification of pane ${notification.pane} of machine ${notification.machine}`

    return yield* retracted(notification).pipe(
      Effect.andThen(forgetSent(notification)),
      Effect.catch((failure) => pauseOrAbandon(what, failure, forgetSent(notification))),
      Effect.catchDefect((defect) =>
        Effect.andThen(Effect.logError(gaveUpOnBug(what), defect), forgetSent(notification)),
      ),
    )
  })

  const drop = (dropped: WantedNotification) =>
    SubscriptionRef.update(wanted, (notifications) =>
      HashMap.modifyAt(
        notifications,
        notificationKey(dropped),
        Option.filter((current) => !isSameNotification(current, dropped)),
      ),
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
      Effect.logError(pausedOnBug('notifier'), defect).pipe(
        Effect.andThen(Effect.sleep(PAUSE_AFTER_HUB_BUG)),
        Effect.as(true),
      ),
    ),
  )

  const reconcile = Effect.repeat(stepOnce, { while: (stepped) => stepped })

  if (hark.delivery === 'ready') {
    const changes = yield* herd.subscribeChanges

    yield* Effect.forEach(Arr.filter(stillWantedAtStart, isApproval), approvals.watch)
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
    Effect.tapError((failure) =>
      Effect.logWarning(`A test notification failed: ${harkFailureForTheLog(failure)}`),
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
  static readonly layer = Layer.effect(this, make)
}
