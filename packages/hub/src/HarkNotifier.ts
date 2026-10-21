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

import { type NotificationEvent, NotificationSettings, withPref } from '@crook/domain/Notifications'
import {
  type HarkFailure,
  HarkReachedNoDevice,
  type TestNotificationFailure,
} from '@crook/protocol/Hark'

import {
  HARK_RATE_WINDOW,
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
  afterPublish,
  afterSeen,
  idempotencyKeyOf,
  identityOf,
  nextStep,
  notificationKey,
} from '@crook/hub/NotificationPlan'
import { NotificationStore } from '@crook/hub/NotificationStore'

export const TEST_NOTIFICATION = new HarkNotification({
  title: 'crook',
  body: 'Test · notifications from crook arrive like this',
  idempotencyKey: Option.none(),
})

const logStorageFailure = (what: string) => (error: SqlError) =>
  Effect.logError(
    `The hub could not store ${what} in its database, so it keeps it in memory only and loses it on restart: ${error.message}. Check the disk and the file at CROOK_HUB_DATABASE_PATH.`,
  )

const pauseFor = (failure: HarkFailure) =>
  Match.value(failure).pipe(
    Match.tag('HarkUnreachable', () => Option.some(HARK_RATE_WINDOW)),
    Match.tag('HarkRateLimited', (limited) =>
      Option.map(limited.retryAfterSeconds, (seconds) => Duration.seconds(seconds)),
    ),
    Match.orElse(() => Option.none()),
  )

const make = Effect.gen(function* () {
  const hark = yield* HarkClient
  const store = yield* NotificationStore
  const herd = yield* Herd
  const prefs = yield* SubscriptionRef.make(yield* store.prefs)
  const sentAtStart = yield* store.sent
  const sent = yield* Ref.make<NotificationsByPane<SentNotification>>(
    HashMap.fromIterable(
      Arr.map(sentAtStart, (notification) => [notificationKey(notification), notification]),
    ),
  )
  const wanted = yield* SubscriptionRef.make<NotificationsByPane<WantedNotification>>(
    HashMap.map(yield* Ref.get(sent), (notification): WantedNotification => notification),
  )
  const abandoned = yield* Ref.make(HashSet.empty<string>())

  const followHerd = (change: HerdChange) =>
    Effect.flatMap(SubscriptionRef.get(prefs), (current) =>
      SubscriptionRef.update(wanted, (byPane) =>
        Match.value(change).pipe(
          Match.tagsExhaustive({
            MachinePublished: (published) => afterPublish(byPane, published, current),
            PaneSeen: (seen) => afterSeen(byPane, seen.machine, seen.pane),
          }),
        ),
      ),
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
        Effect.catch((failure) =>
          pauseOrAbandon(
            `notifying pane ${notification.pane} of machine ${notification.machine}`,
            failure,
            Ref.update(abandoned, HashSet.add(identityOf(notification))),
          ),
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
    return yield* hark.withdraw(notification.harkId).pipe(
      Effect.andThen(forgetSent(notification)),
      Effect.catch((failure) =>
        pauseOrAbandon(
          `withdrawing the notification of pane ${notification.pane} of machine ${notification.machine}`,
          failure,
          forgetSent(notification),
        ),
      ),
    )
  })

  const take = (step: NotificationStep) =>
    Match.value(step).pipe(
      Match.tagsExhaustive({
        Withdraw: (withdrawal) => withdraw(withdrawal.sent),
        Send: (sending) => send(sending.wanted),
        Drop: (dropping) =>
          SubscriptionRef.update(wanted, HashMap.remove(notificationKey(dropping.wanted))),
      }),
    )

  const pruneAbandoned = Effect.flatMap(SubscriptionRef.get(wanted), (byPane) =>
    Ref.update(abandoned, (identities) =>
      HashSet.filter(identities, (identity) =>
        Arr.some(HashMap.toValues(byPane), (notification) => identityOf(notification) === identity),
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
  })

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
    Layer.provide([HarkClient.layer, NotificationStore.layer]),
  )
}
