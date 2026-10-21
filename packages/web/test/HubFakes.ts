import type * as Cause from 'effect/Cause'
import type * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Latch from 'effect/Latch'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import {
  defaultNotificationPrefs,
  NotificationSettings,
  withPref,
} from '@crook/domain/Notifications'
import type { NotificationEvent } from '@crook/domain/Notifications'
import { HubAccount } from '@crook/protocol/ClientApi'
import type { HubStorageFailed } from '@crook/protocol/ClientApi'
import type { TestNotificationFailure } from '@crook/protocol/Hark'
import { HerdCache } from '@crook/web/cache/HerdCache'
import type { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubConnection } from '@crook/web/rpc/HubConnection'
import type { ForgetMachineRefused, HubCallFailed } from '@crook/web/rpc/HubConnection'
import { HubLink } from '@crook/web/rpc/HubLink'
import type { HubNotConnected } from '@crook/web/rpc/HubLink'
import { HubLinkState, LinkStatus } from '@crook/web/rpc/HubLinkState'
import { PageSignals } from '@crook/web/rpc/PageSignals'
import { SessionCheck } from '@crook/web/rpc/SessionCheck'
import type { LogOutFailed } from '@crook/web/rpc/SessionCheck'

export interface FakeSession {
  readonly views: Queue.Queue<HerdView, HubCallFailed | Cause.Done>
  readonly settings: Queue.Queue<NotificationSettings, HubCallFailed | Cause.Done>
}

export interface PrefWrite {
  readonly event: NotificationEvent
  readonly enabled: boolean
}

export interface SeenCall {
  readonly machine: MachineId
  readonly pane: PaneId
}

export const OWNER_EMAIL = 'owner@example.com'

export const readySettings = new NotificationSettings({
  prefs: defaultNotificationPrefs,
  delivery: 'ready',
})

export const makeFakeBrowser = Effect.fn('makeFakeBrowser')(function* (
  cached: Option.Option<HerdSnapshot>,
) {
  const sessions = yield* Queue.unbounded<FakeSession>()
  const opened = yield* Ref.make(0)
  const closed = yield* Ref.make(0)
  const seen = yield* Ref.make<readonly SeenCall[]>([])
  const forgotten = yield* Ref.make<readonly MachineId[]>([])
  const saved = yield* Ref.make(cached)
  const visible = yield* SubscriptionRef.make(true)
  const online = yield* SubscriptionRef.make(true)
  const expired = yield* Ref.make(false)
  const sessionCheckTakes = yield* Ref.make(Option.none<Duration.Duration>())
  const logOutRefusal = yield* Ref.make(Option.none<LogOutFailed>())
  const logOuts = yield* Ref.make(0)
  const whileLoggingOut = yield* Ref.make<Effect.Effect<void>>(Effect.void)
  const prefWrites = yield* Ref.make<readonly PrefWrite[]>([])

  const open = Effect.gen(function* () {
    const views = yield* Queue.unbounded<HerdView, HubCallFailed | Cause.Done>()
    const settings = yield* Queue.unbounded<NotificationSettings, HubCallFailed | Cause.Done>()

    yield* Ref.update(opened, (count) => count + 1)
    yield* Effect.addFinalizer(() => Ref.update(closed, (count) => count + 1))
    yield* Queue.offer(sessions, { views, settings })

    return {
      watchHerd: Stream.fromQueue(views),
      markSeen: (machine: MachineId, pane: PaneId) =>
        Ref.update(seen, (calls) => [...calls, { machine, pane }]),
      forgetMachine: (machine: MachineId) =>
        Ref.update(forgotten, (machines) => [...machines, machine]),
      watchNotificationSettings: Stream.fromQueue(settings),
      setNotificationPref: (event: NotificationEvent, enabled: boolean) =>
        Ref.update(prefWrites, (writes) => [...writes, { event, enabled }]),
      sendTestNotification: Effect.void,
      account: Effect.succeed(new HubAccount({ email: OWNER_EMAIL })),
    }
  })

  const layer = Layer.mergeAll(
    Layer.succeed(HubConnection, HubConnection.of({ open })),
    Layer.succeed(
      HerdCache,
      HerdCache.of({
        load: Ref.get(saved),
        save: (snapshot) => Ref.set(saved, Option.some(snapshot)),
        clear: Ref.set(saved, Option.none()),
      }),
    ),
    Layer.succeed(
      PageSignals,
      PageSignals.of({
        visible: SubscriptionRef.changes(visible),
        online: SubscriptionRef.changes(online),
      }),
    ),
    Layer.succeed(
      SessionCheck,
      SessionCheck.of({
        expired: Effect.andThen(
          Effect.flatMap(
            Ref.get(sessionCheckTakes),
            Option.match({ onNone: () => Effect.void, onSome: Effect.sleep }),
          ),
          Ref.get(expired),
        ),
        logOut: Ref.update(logOuts, (count) => count + 1).pipe(
          Effect.andThen(Effect.flatten(Ref.get(whileLoggingOut))),
          Effect.andThen(Ref.get(logOutRefusal)),
          Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: Effect.fail })),
        ),
      }),
    ),
  )

  return {
    layer,
    sessions,
    opened,
    closed,
    seen,
    forgotten,
    saved,
    visible,
    online,
    expired,
    sessionCheckTakes,
    logOutRefusal,
    logOuts,
    whileLoggingOut,
    prefWrites,
  }
})

export const makeFakeHubLink = Effect.fn('makeFakeHubLink')(function* (initial: HubLinkState) {
  const state = yield* SubscriptionRef.make(initial)
  const seen = yield* Ref.make<readonly SeenCall[]>([])
  const resyncs = yield* Ref.make(0)
  const forgotten = yield* Ref.make<readonly MachineId[]>([])
  const forgetRefusal = yield* Ref.make(
    Option.none<ForgetMachineRefused | HubCallFailed | HubNotConnected>(),
  )
  const forgetAnswers = yield* Latch.make(true)
  const settings = yield* SubscriptionRef.make(readySettings)
  const account = yield* SubscriptionRef.make(new HubAccount({ email: OWNER_EMAIL }))
  const prefWrites = yield* Ref.make<readonly PrefWrite[]>([])
  const prefRefusal = yield* Ref.make(
    Option.none<HubStorageFailed | HubCallFailed | HubNotConnected>(),
  )
  const prefAnswers = yield* Latch.make(true)
  const testSends = yield* Ref.make(0)
  const testRefusal = yield* Ref.make(
    Option.none<TestNotificationFailure | HubCallFailed | HubNotConnected>(),
  )
  const testAnswers = yield* Latch.make(true)
  const logOuts = yield* Ref.make(0)
  const logOutRefusal = yield* Ref.make(Option.none<LogOutFailed>())
  const logOutAnswers = yield* Latch.make(true)

  const answerWith = <Failure>(
    answers: Latch.Latch,
    refusal: Ref.Ref<Option.Option<Failure>>,
    accepted: Effect.Effect<void>,
  ) =>
    Effect.andThen(
      answers.await,
      Effect.flatMap(
        Ref.get(refusal),
        Option.match({ onNone: () => accepted, onSome: Effect.fail }),
      ),
    )

  const layer = Layer.succeed(
    HubLink,
    HubLink.of({
      changes: SubscriptionRef.changes(state),
      resync: Ref.update(resyncs, (count) => count + 1),
      markSeen: (machine, pane) => Ref.update(seen, (calls) => [...calls, { machine, pane }]),
      forgetMachine: (machine) =>
        Effect.andThen(
          forgetAnswers.await,
          Effect.flatMap(
            Ref.get(forgetRefusal),
            Option.match({
              onNone: () => Ref.update(forgotten, (machines) => [...machines, machine]),
              onSome: Effect.fail,
            }),
          ),
        ),
      notificationSettings: SubscriptionRef.changes(settings),
      account: SubscriptionRef.changes(account),
      setNotificationPref: (event, enabled) =>
        answerWith(
          prefAnswers,
          prefRefusal,
          Effect.andThen(
            Ref.update(prefWrites, (writes) => [...writes, { event, enabled }]),
            SubscriptionRef.update(
              settings,
              (current) =>
                new NotificationSettings({
                  prefs: withPref(current.prefs, event, enabled),
                  delivery: current.delivery,
                }),
            ),
          ),
        ),
      sendTestNotification: answerWith(
        testAnswers,
        testRefusal,
        Ref.update(testSends, (count) => count + 1),
      ),
      logOut: answerWith(
        logOutAnswers,
        logOutRefusal,
        Effect.andThen(
          Ref.update(logOuts, (count) => count + 1),
          SubscriptionRef.set(
            state,
            new HubLinkState({ status: LinkStatus.LoggedOut(), herd: Option.none() }),
          ),
        ),
      ),
    }),
  )

  return {
    layer,
    state,
    seen,
    resyncs,
    forgotten,
    forgetRefusal,
    forgetAnswers,
    settings,
    account,
    prefWrites,
    prefRefusal,
    prefAnswers,
    testSends,
    testRefusal,
    testAnswers,
    logOuts,
    logOutRefusal,
    logOutAnswers,
  }
})

export const dropSession = (session: FakeSession, error: HubCallFailed) =>
  Queue.fail(session.views, error)
