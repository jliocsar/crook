import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { Command, CommandReceipt } from '@crook/domain/Command'
import type { HerdView } from '@crook/domain/HerdView'
import type { IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'
import type { NotificationEvent, NotificationSettings } from '@crook/domain/Notifications'
import type {
  TranscriptEvent,
  TranscriptPosition,
  TranscriptSource,
  TranscriptTailBytes,
} from '@crook/domain/Transcript'
import { hubReconnectSchedule, stayedHealthy } from '@crook/protocol/AgentLink'
import type { CommandFailure } from '@crook/protocol/Commands'
import type { HubAccount, HubStorageFailed } from '@crook/protocol/ClientApi'
import type { TestNotificationFailure } from '@crook/protocol/Hark'
import { HerdCache, HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubConnection } from '@crook/web/rpc/HubConnection'
import type {
  ForgetMachineRefused,
  HubCallDefected,
  HubCallFailed,
  HubCalls,
  MarkSeenRefused,
  SetPinnedRefused,
  WatchTranscriptRefused,
} from '@crook/web/rpc/HubConnection'
import {
  announce,
  beginAttempt,
  COLD_START,
  goLive,
  HubLinkState,
  isRecovering,
  LinkStatus,
  settledSince,
  settleRecovered,
} from '@crook/web/rpc/HubLinkState'
import { PageSignals } from '@crook/web/rpc/PageSignals'
import { SessionCheck } from '@crook/web/rpc/SessionCheck'
import type { LogOutFailed } from '@crook/web/rpc/SessionCheck'

type SessionFailure = HubCallFailed | HubWatchEnded

type ConnectedCalls = SubscriptionRef.SubscriptionRef<Option.Option<HubCalls>>

export interface TranscriptResume {
  readonly from: Option.Option<TranscriptPosition>
  readonly tail: Option.Option<TranscriptTailBytes>
}

export const SYNC_NOTICE_DELAY = Duration.seconds(1)
export const RECOVERED_NOTICE_DURATION = Duration.millis(1500)

const isLoggedOut = LinkStatus.$is('LoggedOut')

export class HubWatchEnded extends Schema.TaggedError<HubWatchEnded>()('HubWatchEnded', {}) {
  override get message(): string {
    return 'The hub closed the herd stream while the connection stayed up. crook reconnects on its own; if this keeps happening, read the hub logs.'
  }
}

export class HubNotConnected extends Schema.TaggedError<HubNotConnected>()('HubNotConnected', {}) {
  override get message(): string {
    return 'crook is not connected to the hub right now, so nothing was sent, and nothing is queued for later. Try again once the banner at the top is gone.'
  }
}

const whenConnected = <Success, Failure>(
  connected: ConnectedCalls,
  call: (calls: HubCalls) => Effect.Effect<Success, Failure>,
) =>
  Effect.flatMap(
    SubscriptionRef.get(connected),
    (hub): Effect.Effect<Success, Failure | HubNotConnected> =>
      Option.match(hub, {
        onNone: () => Effect.fail(new HubNotConnected()),
        onSome: call,
      }),
  )

const whileConnected = <Success, Failure>(
  connected: ConnectedCalls,
  watch: (calls: HubCalls) => Stream.Stream<Success, Failure | HubCallFailed>,
) =>
  SubscriptionRef.changes(connected).pipe(
    Stream.switchMap(
      Option.match({
        onNone: () => Stream.empty,
        onSome: (calls: HubCalls) =>
          watch(calls).pipe(Stream.catchTag('HubConnectionLost', () => Stream.empty)),
      }),
    ),
  )

const make = Effect.gen(function* () {
  const connection = yield* HubConnection
  const cache = yield* HerdCache
  const page = yield* PageSignals
  const sessionCheck = yield* SessionCheck
  const cachedHerd = yield* cache.load
  const state = yield* SubscriptionRef.make(
    new HubLinkState({ status: COLD_START, herd: cachedHerd }),
  )
  const connected = yield* SubscriptionRef.make(Option.none<HubCalls>())
  const resyncRequests = yield* SubscriptionRef.make(0)
  const loggedOut = yield* SubscriptionRef.make(false)
  const cacheWrites = yield* Semaphore.make(1)

  const saveCurrentHerd = cacheWrites.withPermit(
    Effect.flatMap(SubscriptionRef.get(state), (current) =>
      Option.match(current.herd, { onNone: () => Effect.void, onSome: cache.save }),
    ),
  )

  yield* SubscriptionRef.changes(state).pipe(
    Stream.map((current) => current.herd),
    Stream.changesWith((before, after) => before === after),
    Stream.filter((herd) => herd !== cachedHerd),
    Stream.buffer({ capacity: 1, strategy: 'sliding' }),
    Stream.runForEach(() =>
      saveCurrentHerd.pipe(
        Effect.catchDefect((defect) =>
          Effect.logError('crook could not cache the herd on this device', defect),
        ),
      ),
    ),
    Effect.forkScoped,
  )

  const updateStatus = (step: (status: LinkStatus) => LinkStatus) =>
    SubscriptionRef.update(
      state,
      (current) => new HubLinkState({ status: step(current.status), herd: current.herd }),
    )

  const receive = Effect.fn('HubLink.receive')(function* (
    view: HerdView,
    hub: HubCalls,
    liveSince: Ref.Ref<Option.Option<number>>,
  ) {
    const firstOfSession = Option.isNone(yield* Ref.get(liveSince))

    if (firstOfSession) {
      yield* Ref.set(liveSince, Option.some(yield* Clock.currentTimeMillis))
      yield* SubscriptionRef.set(connected, Option.some(hub))
    }

    const snapshot = new HerdSnapshot({ view, syncedAt: yield* DateTime.now })
    const next = yield* SubscriptionRef.updateAndGet(
      state,
      (current) =>
        new HubLinkState({ status: goLive(current.status), herd: Option.some(snapshot) }),
    )

    if (firstOfSession && isRecovering(next.status)) {
      yield* Effect.sleep(RECOVERED_NOTICE_DURATION).pipe(
        Effect.andThen(updateStatus(settleRecovered)),
        Effect.forkScoped,
      )
    }
  })

  const attempt = Effect.fn('HubLink.attempt')(function* (
    liveSince: Ref.Ref<Option.Option<number>>,
  ) {
    const hub = yield* connection.open

    yield* Effect.addFinalizer(() => SubscriptionRef.set(connected, Option.none()))
    yield* hub.watchHerd.pipe(Stream.runForEach((view) => receive(view, hub, liveSince)))

    return yield* new HubWatchEnded()
  }, Effect.scoped)

  const refuse = Effect.fn('HubLink.refuse')(function* (error: SessionFailure) {
    yield* Effect.logWarning(error.message)

    if (yield* sessionCheck.expired) {
      yield* updateStatus(() => LinkStatus.Expired())

      return yield* Effect.never
    }

    yield* updateStatus(() => LinkStatus.Unreachable())

    return yield* error
  })

  const session = Effect.gen(function* () {
    const liveSince = yield* Ref.make(Option.none<number>())
    const healthy = Effect.zipWith(Ref.get(liveSince), Clock.currentTimeMillis, stayedHealthy)

    yield* updateStatus(beginAttempt)
    yield* Effect.sleep(SYNC_NOTICE_DELAY).pipe(
      Effect.andThen(updateStatus(announce)),
      Effect.forkScoped,
    )
    yield* attempt(liveSince).pipe(
      Effect.catch((error) =>
        Effect.flatMap(healthy, (stayed) =>
          stayed ? Effect.logWarning(error.message) : refuse(error),
        ),
      ),
    )
  }).pipe(Effect.scoped, Effect.withSpan('HubLink.session'))

  const stayConnected = session.pipe(
    Effect.retry(hubReconnectSchedule),
    Effect.orDie,
    Effect.forever,
  )

  const follow = (visible: boolean, online: boolean, ended: boolean): Effect.Effect<never> => {
    if (ended) {
      const forget = cache.clear.pipe(
        Effect.andThen(
          SubscriptionRef.set(
            state,
            new HubLinkState({ status: LinkStatus.LoggedOut(), herd: Option.none() }),
          ),
        ),
      )

      return cacheWrites.withPermit(forget).pipe(Effect.andThen(Effect.never))
    }

    if (!visible) {
      return Effect.never
    }

    if (!online) {
      return Effect.andThen(
        updateStatus(() => LinkStatus.Offline()),
        Effect.never,
      )
    }

    return stayConnected
  }

  const follower = yield* Stream.zipLatestAll(
    page.visible,
    page.online,
    SubscriptionRef.changes(loggedOut),
    SubscriptionRef.changes(resyncRequests),
  ).pipe(
    Stream.switchMap(([visible, online, ended]) =>
      Stream.fromEffect(follow(visible, online, ended)),
    ),
    Stream.runDrain,
    Effect.forkScoped,
  )

  const resync = Effect.gen(function* () {
    const requestedAt = yield* DateTime.now

    yield* SubscriptionRef.update(resyncRequests, (count) => count + 1)
    yield* SubscriptionRef.changes(state).pipe(
      Stream.filter(settledSince(requestedAt)),
      Stream.take(1),
      Stream.runDrain,
    )
  }).pipe(Effect.withSpan('HubLink.resync'))

  const connectedCall = <Args extends readonly unknown[], Success, Failure>(
    name: string,
    pick: (calls: HubCalls) => (...args: Args) => Effect.Effect<Success, Failure>,
  ): ((...args: Args) => Effect.Effect<Success, Failure | HubNotConnected>) =>
    Effect.fn(name)(function* (...args: Args) {
      return yield* whenConnected(connected, (calls) => pick(calls)(...args))
    })

  const sendTestNotification = whenConnected(connected, (calls) => calls.sendTestNotification).pipe(
    Effect.withSpan('HubLink.sendTestNotification'),
  )

  const logOut = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* sessionCheck.logOut
      yield* SubscriptionRef.set(loggedOut, true)
      yield* restore(
        SubscriptionRef.changes(state).pipe(
          Stream.filter((current) => isLoggedOut(current.status)),
          Stream.take(1),
          Stream.runDrain,
        ),
      )
    }),
  ).pipe(Effect.withSpan('HubLink.logOut'))

  const watchTranscript = (
    machine: MachineId,
    source: TranscriptSource,
    resume: Effect.Effect<TranscriptResume>,
  ): Stream.Stream<TranscriptEvent, WatchTranscriptRefused | HubCallDefected> =>
    whileConnected(connected, (calls) =>
      Stream.unwrap(
        Effect.map(resume, ({ from, tail }) =>
          calls.watchTranscript({ machine, source, from, tail }),
        ),
      ),
    )

  return HubLink.of({
    changes: Stream.merge(
      SubscriptionRef.changes(state),
      Stream.fromEffectDrain(Fiber.join(follower)),
    ),
    resync,
    markSeen: connectedCall('HubLink.markSeen', (calls) => calls.markSeen),
    forgetMachine: connectedCall('HubLink.forgetMachine', (calls) => calls.forgetMachine),
    setPinned: connectedCall('HubLink.setPinned', (calls) => calls.setPinned),
    sendCommand: connectedCall('HubLink.sendCommand', (calls) => calls.sendCommand),
    notificationSettings: whileConnected(connected, (calls) => calls.watchNotificationSettings),
    account: whileConnected(connected, (calls) => Stream.fromEffect(calls.account)),
    setNotificationPref: connectedCall(
      'HubLink.setNotificationPref',
      (calls) => calls.setNotificationPref,
    ),
    sendTestNotification,
    logOut,
    watchTranscript,
  })
})

export class HubLink extends Context.Service<
  HubLink,
  {
    readonly changes: Stream.Stream<HubLinkState>
    readonly resync: Effect.Effect<void>
    readonly markSeen: (
      machine: MachineId,
      pane: PaneId,
    ) => Effect.Effect<void, MarkSeenRefused | HubCallFailed | HubNotConnected>
    readonly forgetMachine: (
      machine: MachineId,
    ) => Effect.Effect<void, ForgetMachineRefused | HubCallFailed | HubNotConnected>
    readonly setPinned: (
      machine: MachineId,
      pane: PaneId,
      pinned: boolean,
    ) => Effect.Effect<void, SetPinnedRefused | HubCallFailed | HubNotConnected>
    readonly sendCommand: (
      machine: MachineId,
      key: IdempotencyKey,
      command: Command,
    ) => Effect.Effect<CommandReceipt, CommandFailure | HubCallFailed | HubNotConnected>
    readonly notificationSettings: Stream.Stream<NotificationSettings, HubCallDefected>
    readonly account: Stream.Stream<HubAccount, HubCallDefected>
    readonly setNotificationPref: (
      event: NotificationEvent,
      enabled: boolean,
    ) => Effect.Effect<void, HubStorageFailed | HubCallFailed | HubNotConnected>
    readonly sendTestNotification: Effect.Effect<
      void,
      TestNotificationFailure | HubCallFailed | HubNotConnected
    >
    readonly logOut: Effect.Effect<void, LogOutFailed>
    readonly watchTranscript: (
      machine: MachineId,
      source: TranscriptSource,
      resume: Effect.Effect<TranscriptResume>,
    ) => Stream.Stream<TranscriptEvent, WatchTranscriptRefused | HubCallDefected>
  }
>()('@crook/web/HubLink') {
  static readonly layerWithoutBrowser = Layer.effect(this, make)

  static readonly layer = Layer.provide(this.layerWithoutBrowser, [
    HubConnection.layer,
    HerdCache.layer,
    PageSignals.layer,
    SessionCheck.layer,
  ])
}
