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
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { hubReconnectSchedule, stayedHealthy } from '@crook/protocol/AgentLink'
import { HerdCache, HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubConnection } from '@crook/web/rpc/HubConnection'
import type {
  ForgetMachineRefused,
  HubCallFailed,
  HubCalls,
  MarkSeenRefused,
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

type SessionFailure = HubCallFailed | HubWatchEnded

export const SYNC_NOTICE_DELAY = Duration.seconds(1)
export const RECOVERED_NOTICE_DURATION = Duration.millis(1500)

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

const make = Effect.gen(function* () {
  const connection = yield* HubConnection
  const cache = yield* HerdCache
  const page = yield* PageSignals
  const sessionCheck = yield* SessionCheck
  const state = yield* SubscriptionRef.make(
    new HubLinkState({ status: COLD_START, herd: yield* cache.load }),
  )
  const connected = yield* Ref.make(Option.none<HubCalls>())
  const resyncRequests = yield* SubscriptionRef.make(0)

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
      yield* Ref.set(connected, Option.some(hub))
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

    yield* cache.save(snapshot)
  })

  const attempt = Effect.fn('HubLink.attempt')(function* (
    liveSince: Ref.Ref<Option.Option<number>>,
  ) {
    const hub = yield* connection.open

    yield* Effect.addFinalizer(() => Ref.set(connected, Option.none()))
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

  const follow = (visible: boolean, online: boolean): Effect.Effect<never> => {
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
    SubscriptionRef.changes(resyncRequests),
  ).pipe(
    Stream.switchMap(([visible, online]) => Stream.fromEffect(follow(visible, online))),
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

  const whenConnected = <Success, Failure>(
    call: (calls: HubCalls) => Effect.Effect<Success, Failure>,
  ) =>
    Effect.flatMap(Ref.get(connected), (hub): Effect.Effect<Success, Failure | HubNotConnected> =>
      Option.match(hub, {
        onNone: () => Effect.fail(new HubNotConnected()),
        onSome: call,
      }),
    )

  const markSeen = Effect.fn('HubLink.markSeen')(function* (machine: MachineId, pane: PaneId) {
    return yield* whenConnected((calls) => calls.markSeen(machine, pane))
  })

  const forgetMachine = Effect.fn('HubLink.forgetMachine')(function* (machine: MachineId) {
    return yield* whenConnected((calls) => calls.forgetMachine(machine))
  })

  return HubLink.of({
    changes: Stream.merge(
      SubscriptionRef.changes(state),
      Stream.fromEffectDrain(Fiber.join(follower)),
    ),
    resync,
    markSeen,
    forgetMachine,
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
