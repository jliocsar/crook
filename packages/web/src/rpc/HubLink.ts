import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { AGENT_PING_INTERVAL } from '@crook/protocol/AgentLink'
import { HerdCache, HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubConnection } from '@crook/web/rpc/HubConnection'
import type { HubCalls, HubConnectionLost, MarkSeenRefused } from '@crook/web/rpc/HubConnection'
import {
  announce,
  beginAttempt,
  goLive,
  HubLinkState,
  isRecovering,
  LinkStatus,
  QUIET_DIALING,
  settledSince,
  settleRecovered,
} from '@crook/web/rpc/HubLinkState'
import { PageSignals } from '@crook/web/rpc/PageSignals'
import { SessionCheck } from '@crook/web/rpc/SessionCheck'

type SessionFailure = HubConnectionLost | HubWatchEnded

export const HUB_RECONNECT_BASE = Duration.millis(77)
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
    new HubLinkState({ status: QUIET_DIALING, herd: yield* cache.load }),
  )
  const connected = yield* Ref.make(Option.none<HubCalls>())
  const resyncRequests = yield* SubscriptionRef.make(0)

  const updateStatus = (step: (status: LinkStatus) => LinkStatus) =>
    SubscriptionRef.update(
      state,
      (current) => new HubLinkState({ status: step(current.status), herd: current.herd }),
    )

  const stayedHealthy = (liveSince: Ref.Ref<Option.Option<number>>) =>
    Effect.zipWith(Ref.get(liveSince), Clock.currentTimeMillis, (since, now) =>
      Option.exists(since, (first) => now - first >= Duration.toMillis(AGENT_PING_INTERVAL)),
    )

  const receive = Effect.fn('HubLink.receive')(function* (
    view: HerdView,
    liveSince: Ref.Ref<Option.Option<number>>,
  ) {
    const snapshot = new HerdSnapshot({ view, syncedAt: yield* DateTime.now })
    const next = yield* SubscriptionRef.modify(state, (current) => {
      const updated = new HubLinkState({
        status: goLive(current.status),
        herd: Option.some(snapshot),
      })

      return [updated, updated]
    })
    const firstOfSession = Option.isNone(yield* Ref.get(liveSince))

    if (firstOfSession) {
      yield* Ref.set(liveSince, Option.some(yield* Clock.currentTimeMillis))
    }

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
    yield* updateStatus(beginAttempt)
    yield* Effect.sleep(SYNC_NOTICE_DELAY).pipe(
      Effect.andThen(updateStatus(announce)),
      Effect.forkScoped,
    )

    const hub = yield* connection.open

    yield* Effect.acquireRelease(Ref.set(connected, Option.some(hub)), () =>
      Ref.set(connected, Option.none()),
    )
    yield* hub.watchHerd.pipe(Stream.runForEach((view) => receive(view, liveSince)))

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

    yield* attempt(liveSince).pipe(
      Effect.catch((error) =>
        Effect.flatMap(stayedHealthy(liveSince), (healthy) =>
          healthy ? Effect.logWarning(error.message) : refuse(error),
        ),
      ),
    )
  })

  const stayConnected = session.pipe(
    Effect.retry(
      Schedule.min([
        Schedule.exponential(HUB_RECONNECT_BASE),
        Schedule.spaced(AGENT_PING_INTERVAL),
      ]),
    ),
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

  yield* Stream.zipLatestAll(
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

  const markSeen = Effect.fn('HubLink.markSeen')(function* (machine: MachineId, pane: PaneId) {
    const hub = yield* Ref.get(connected)

    return yield* Option.match(hub, {
      onNone: () => Effect.fail(new HubNotConnected()),
      onSome: (calls) => calls.markSeen(machine, pane),
    })
  })

  return HubLink.of({ changes: SubscriptionRef.changes(state), resync, markSeen })
})

export class HubLink extends Context.Service<
  HubLink,
  {
    readonly changes: Stream.Stream<HubLinkState>
    readonly resync: Effect.Effect<void>
    readonly markSeen: (
      machine: MachineId,
      pane: PaneId,
    ) => Effect.Effect<void, MarkSeenRefused | HubConnectionLost | HubNotConnected>
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
