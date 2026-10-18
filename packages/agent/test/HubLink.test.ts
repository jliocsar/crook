import * as BunHttpServer from '@effect/platform-bun/BunHttpServer'
import { expect, it, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as Headers from 'effect/http/Headers'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import * as RpcServer from 'effect/rpc/RpcServer'
import * as RpcTest from 'effect/rpc/RpcTest'
import * as TestClock from 'effect/testing/TestClock'

import * as HubLink from '@crook/agent/HubLink'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { MachineId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { AgentLink, MachineIdMismatch } from '@crook/protocol/AgentLink'
import { protocolSerialization } from '@crook/protocol/Serialization'

interface HubScript {
  readonly attachLifetime: Option.Option<Duration.Duration>
  readonly reply: (state: MachineState) => Effect.Effect<void, MachineIdMismatch>
}

interface Publication {
  readonly authorization: Option.Option<string>
  readonly state: MachineState
}

const HUB_PATH = '/rpc/agent'
const LAPTOP = MachineId.make('laptop')
const TICK = Duration.millis(1)

const stateAt = (version: number) =>
  new MachineState({
    machine: LAPTOP,
    version: MachineStateVersion.make(version),
    workspaces: [],
    tabs: [],
    agents: [],
  })

const startLink = Effect.fn('startLink')(function* (script: Partial<HubScript> = {}) {
  const attachLifetime = script.attachLifetime ?? Option.none()
  const reply = script.reply ?? (() => Effect.void)
  const state = yield* SubscriptionRef.make(stateAt(0))
  const attempts = yield* Ref.make<readonly number[]>([])
  const received = yield* Queue.unbounded<MachineState>()

  const connect = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis

    yield* Ref.update(attempts, Arr.append(now))

    const handlers = yield* Layer.build(
      AgentLink.toLayer({
        Attach: () =>
          Option.match(attachLifetime, {
            onNone: () => Stream.never,
            onSome: (lifetime) => Stream.fromEffectDrain(Effect.sleep(lifetime)),
          }),
        PublishState: ({ state: published }) =>
          Queue.offer(received, published).pipe(Effect.andThen(reply(published))),
      }),
    )

    return yield* RpcTest.makeClient(AgentLink).pipe(Effect.provide(handlers))
  })

  yield* Layer.build(Layer.provide(HubLink.layerWith(connect), MachineStateSync.layerTest(state)))

  return { state, received, attempts: Ref.get(attempts) }
})

const backoffTimeline = (failedAttempts: number, attachLifetime: Duration.Duration) =>
  pipe(
    Arr.makeBy(failedAttempts, (attempt) =>
      Duration.min(
        Duration.times(HubLink.HUB_RECONNECT_BASE, 2 ** attempt),
        HubLink.HUB_PING_INTERVAL,
      ),
    ),
    Arr.scan(0, (at, delay) => at + Duration.toMillis(Duration.sum(attachLifetime, delay))),
  )

it.effect('publishes the current state once connected, then every new version', () =>
  Effect.gen(function* () {
    const { state, received } = yield* startLink()

    expect(yield* Queue.take(received)).toEqual(stateAt(0))

    yield* SubscriptionRef.set(state, stateAt(1))

    expect(yield* Queue.take(received)).toEqual(stateAt(1))
  }),
)

it.effect('republishes the current state when it reconnects after the hub ends Attach', () =>
  Effect.gen(function* () {
    const { state, received, attempts } = yield* startLink({ attachLifetime: Option.some(TICK) })

    yield* Queue.take(received)
    yield* SubscriptionRef.set(state, stateAt(1))
    yield* Queue.take(received)
    yield* TestClock.adjust(Duration.sum(TICK, HubLink.HUB_RECONNECT_BASE))

    expect(yield* Queue.take(received)).toEqual(stateAt(1))
    expect(yield* attempts).toEqual(backoffTimeline(1, TICK))
  }),
)

it.effect('doubles the delay after each failed connection, up to the ping interval', () =>
  Effect.gen(function* () {
    const { attempts } = yield* startLink({ attachLifetime: Option.some(TICK) })
    const expected = backoffTimeline(9, TICK)

    yield* TestClock.adjust(Duration.millis(Arr.lastNonEmpty(expected)))

    expect(yield* attempts).toEqual(expected)
  }),
)

it.effect('reconnects at once after a connection the hub accepted for a ping interval', () =>
  Effect.gen(function* () {
    const { received, attempts } = yield* startLink({
      attachLifetime: Option.some(HubLink.HUB_PING_INTERVAL),
    })
    const healthyEnds = [1, 2, 3].map((connection) =>
      Duration.toMillis(Duration.times(HubLink.HUB_PING_INTERVAL, connection)),
    )

    yield* Queue.take(received)
    yield* TestClock.adjust(Duration.times(HubLink.HUB_PING_INTERVAL, 3))

    expect(yield* attempts).toEqual([0, ...healthyEnds])
  }),
)

it.effect('reconnects with backoff when the hub rejects a publish', () =>
  Effect.gen(function* () {
    const { received, attempts } = yield* startLink({
      reply: (state) =>
        Effect.andThen(
          Effect.sleep(TICK),
          Effect.fail(
            new MachineIdMismatch({
              connectedMachine: MachineId.make('work-vm'),
              publishedMachine: state.machine,
            }),
          ),
        ),
    })

    yield* Queue.take(received)
    yield* TestClock.adjust(Duration.sum(TICK, HubLink.HUB_RECONNECT_BASE))

    expect(yield* attempts).toEqual(backoffTimeline(1, TICK))
  }),
)

it.effect('reconnects with backoff when a hub call dies', () =>
  Effect.gen(function* () {
    const { received, attempts } = yield* startLink({
      reply: () => Effect.andThen(Effect.sleep(TICK), Effect.die('hub handler crashed')),
    })

    yield* Queue.take(received)
    yield* TestClock.adjust(Duration.sum(TICK, HubLink.HUB_RECONNECT_BASE))

    expect(yield* attempts).toEqual(backoffTimeline(1, TICK))
  }),
)

it.effect('skips the versions that went stale while a publish was in flight', () =>
  Effect.gen(function* () {
    const accepted = yield* Deferred.make<void>()
    const { state, received } = yield* startLink({ reply: () => Deferred.await(accepted) })

    expect(yield* Queue.take(received)).toEqual(stateAt(0))

    yield* SubscriptionRef.set(state, stateAt(1))
    yield* SubscriptionRef.set(state, stateAt(2))
    yield* SubscriptionRef.set(state, stateAt(3))
    yield* Deferred.succeed(accepted, undefined)

    expect(yield* Queue.take(received)).toEqual(stateAt(3))
  }),
)

const hubProtocol = RpcServer.layerProtocolWebsocket({ path: HUB_PATH }).pipe(
  Layer.provide(protocolSerialization),
)

const hubServer = (port: number, publications: Queue.Queue<Publication>) =>
  HttpRouter.serve(
    RpcServer.layer(AgentLink).pipe(
      Layer.provide([
        AgentLink.toLayer({
          Attach: () => Stream.never,
          PublishState: ({ state }, { headers }) =>
            Queue.offer(publications, {
              authorization: Headers.get(headers, 'x-exedev-authorization'),
              state,
            }).pipe(Effect.andThen(Effect.void)),
        }),
        hubProtocol,
      ]),
    ),
    { disableLogger: true },
  ).pipe(
    Layer.provideMerge(
      BunHttpServer.layer({ hostname: '127.0.0.1', port, gracefulShutdownTimeout: Duration.zero }),
    ),
  )

const startHub = Effect.fn('startHub')(function* (
  port: number,
  publications: Queue.Queue<Publication>,
) {
  const scope = yield* Scope.fork(yield* Effect.scope)
  const context = yield* Layer.buildWithScope(hubServer(port, publications), scope)
  const address = yield* HttpServer.addressFormattedWith(Effect.succeed).pipe(
    Effect.provide(context),
  )

  return { scope, url: new URL(address) }
})

layer(Layer.empty, { excludeTestServices: true })('HubLink over a real socket', (live) => {
  live.effect('sends the bearer token and republishes after the hub restarts', () =>
    Effect.gen(function* () {
      const publications = yield* Queue.unbounded<Publication>()
      const hub = yield* startHub(0, publications)
      const state = yield* SubscriptionRef.make(stateAt(0))

      yield* Layer.build(
        Layer.provide(HubLink.layer, [
          MachineStateSync.layerTest(state),
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              CROOK_HUB_URL: `ws://${hub.url.host}${HUB_PATH}`,
              CROOK_HUB_TOKEN: 'exe0.vm-token',
            }),
          ),
        ]),
      )

      expect(yield* Queue.take(publications)).toEqual({
        authorization: Option.some('Bearer exe0.vm-token'),
        state: stateAt(0),
      })

      yield* Scope.close(hub.scope, Exit.void)
      yield* SubscriptionRef.set(state, stateAt(1))
      yield* startHub(Number(hub.url.port), publications)
      const republished = yield* Queue.take(publications)

      expect(republished.state).toEqual(stateAt(1))
    }),
  )
})
