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
import * as Result from 'effect/Result'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as Headers from 'effect/http/Headers'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import * as RpcServer from 'effect/rpc/RpcServer'
import * as RpcTest from 'effect/rpc/RpcTest'
import * as TestClock from 'effect/testing/TestClock'

import { CommandExecutor } from '@crook/agent/CommandExecutor'
import { CommandPolicy } from '@crook/agent/CommandPolicy'
import * as HubLink from '@crook/agent/HubLink'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { InputDelivered, Prompt, SendKeys } from '@crook/domain/Command'
import { IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type SentRequest,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import { AgentPromptMethod, AgentSendKeysMethod } from '@crook/herdr/Methods'
import { AGENT_PING_INTERVAL, AgentLink, MachineIdMismatch } from '@crook/protocol/AgentLink'
import {
  CommandId,
  type CommandResult,
  PaneNotAgent,
  RoutedCommand,
} from '@crook/protocol/Commands'
import { protocolSerialization } from '@crook/protocol/Serialization'

import { agentRow } from './Fixtures'

interface HubScript {
  readonly attachLifetime: Option.Option<Duration.Duration>
  readonly reply: (state: MachineState) => Effect.Effect<void, MachineIdMismatch>
  readonly commands: readonly RoutedCommand[]
}

interface Publication {
  readonly authorization: Option.Option<string>
  readonly state: MachineState
}

interface Completion {
  readonly id: CommandId
  readonly result: CommandResult
}

interface RealHub {
  readonly publications: Queue.Queue<Publication>
  readonly completions: Queue.Queue<Completion>
}

const HUB_PATH = '/rpc/agent'
const LAPTOP = MachineId.make('laptop')
const TICK = Duration.millis(1)
const AGENT_PANE = PaneId.make('w1:p1')
const SHELL_PANE = PaneId.make('w1:p2')
const ACTION = IdempotencyKey.make('3f1c8a52-0b7e-4d0a-9a51-6f3f0d2f8e11')
const OTHER_ACTION = IdempotencyKey.make('9b2e4d17-5c6a-4f81-8e0d-2a7c1b9f4e63')

const stateAt = (version: number) =>
  new MachineState({
    machine: LAPTOP,
    version: MachineStateVersion.make(version),
    workspaces: [],
    tabs: [],
    agents: [agentRow()],
  })

const routed = (id: number, key: IdempotencyKey, command: RoutedCommand['command']) =>
  new RoutedCommand({ id: CommandId.make(id), key, command })

const continuePrompt = new Prompt({ pane: AGENT_PANE, text: 'continue' })

const delivered = Result.succeed(new InputDelivered({ pane: AGENT_PANE, stateChangeSeq: 4 }))

const agentWith = (
  state: SubscriptionRef.SubscriptionRef<MachineState>,
  sent: Queue.Queue<SentRequest>,
) =>
  Effect.map(Queue.unbounded<HerdrEvent, HerdrSubscriptionError>(), (events) => {
    const sync = MachineStateSync.layerTest(state)
    const herdr = HerdrClient.layerTest({
      responses: [
        scriptedResult(AgentPromptMethod, { type: 'agent_prompted' }),
        scriptedResult(AgentSendKeysMethod, { type: 'ok' }),
      ],
      events,
      sent,
    })
    const executor = Layer.provide(CommandExecutor.layer, [
      Layer.provide(CommandPolicy.layer, sync),
      herdr,
    ])

    return Layer.merge(sync, executor)
  })

const startLink = Effect.fn('startLink')(function* (script: Partial<HubScript> = {}) {
  const attachLifetime = script.attachLifetime ?? Option.none()
  const reply = script.reply ?? (() => Effect.void)
  const commands = script.commands ?? []
  const state = yield* SubscriptionRef.make(stateAt(0))
  const attempts = yield* Ref.make<readonly number[]>([])
  const received = yield* Queue.unbounded<MachineState>()
  const completed = yield* Queue.unbounded<Completion>()
  const sent = yield* Queue.unbounded<SentRequest>()

  const connect = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis

    yield* Ref.update(attempts, Arr.append(now))

    const handlers = yield* Layer.build(
      AgentLink.toLayer({
        Attach: () =>
          Stream.concat(
            Stream.fromIterable(commands),
            Option.match(attachLifetime, {
              onNone: () => Stream.never,
              onSome: (lifetime) => Stream.fromEffectDrain(Effect.sleep(lifetime)),
            }),
          ),
        PublishState: ({ state: published }) =>
          Queue.offer(received, published).pipe(Effect.andThen(reply(published))),
        CompleteCommand: (completion) =>
          Queue.offer(completed, completion).pipe(Effect.andThen(Effect.void)),
      }),
    )

    return yield* RpcTest.makeClient(AgentLink).pipe(Effect.provide(handlers))
  })

  yield* Layer.build(Layer.provide(HubLink.layerWith(connect), yield* agentWith(state, sent)))

  return { state, received, completed, sent: Queue.clear(sent), attempts: Ref.get(attempts) }
})

const backoffTimeline = (failedAttempts: number, attachLifetime: Duration.Duration) =>
  pipe(
    Arr.makeBy(failedAttempts, (attempt) =>
      Duration.min(Duration.times(HubLink.HUB_RECONNECT_BASE, 2 ** attempt), AGENT_PING_INTERVAL),
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
      attachLifetime: Option.some(AGENT_PING_INTERVAL),
    })
    const healthyEnds = [1, 2, 3].map((connection) =>
      Duration.toMillis(Duration.times(AGENT_PING_INTERVAL, connection)),
    )

    yield* Queue.take(received)
    yield* TestClock.adjust(Duration.times(AGENT_PING_INTERVAL, 3))

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

it.effect('runs each command the hub pushes down Attach and answers it with its outcome', () =>
  Effect.gen(function* () {
    const { completed, sent } = yield* startLink({
      commands: [
        routed(0, ACTION, continuePrompt),
        routed(1, ACTION, continuePrompt),
        routed(2, OTHER_ACTION, new SendKeys({ pane: SHELL_PANE, keys: ['esc'] })),
      ],
    })
    const answers = yield* Queue.takeN(completed, 3)

    expect(answers).toEqual([
      { id: CommandId.make(0), result: delivered },
      { id: CommandId.make(1), result: delivered },
      { id: CommandId.make(2), result: Result.fail(new PaneNotAgent({ pane: SHELL_PANE })) },
    ])
    expect((yield* sent).map((request) => request.method)).toEqual(['agent.prompt'])
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

const hubServer = (port: number, hub: RealHub) =>
  HttpRouter.serve(
    RpcServer.layer(AgentLink).pipe(
      Layer.provide([
        AgentLink.toLayer({
          Attach: () => Stream.concat(Stream.make(routed(0, ACTION, continuePrompt)), Stream.never),
          PublishState: ({ state }, { headers }) =>
            Queue.offer(hub.publications, {
              authorization: Headers.get(headers, 'x-exedev-authorization'),
              state,
            }).pipe(Effect.andThen(Effect.void)),
          CompleteCommand: (completion) =>
            Queue.offer(hub.completions, completion).pipe(Effect.andThen(Effect.void)),
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

const startHub = Effect.fn('startHub')(function* (port: number, hub: RealHub) {
  const scope = yield* Scope.fork(yield* Effect.scope)
  const context = yield* Layer.buildWithScope(hubServer(port, hub), scope)
  const address = yield* HttpServer.addressFormattedWith(Effect.succeed).pipe(
    Effect.provide(context),
  )

  return { scope, url: new URL(address) }
})

layer(Layer.empty, { excludeTestServices: true })('HubLink over a real socket', (live) => {
  live.effect('sends the bearer token and republishes after the hub restarts', () =>
    Effect.gen(function* () {
      const publications = yield* Queue.unbounded<Publication>()
      const completions = yield* Queue.unbounded<Completion>()
      const hub = yield* startHub(0, { publications, completions })
      const state = yield* SubscriptionRef.make(stateAt(0))
      const sent = yield* Queue.unbounded<SentRequest>()

      yield* Layer.build(
        Layer.provide(HubLink.layer, [
          yield* agentWith(state, sent),
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
      yield* startHub(Number(hub.url.port), { publications, completions })
      const republished = yield* Queue.take(publications)

      expect(republished.state).toEqual(stateAt(1))
    }),
  )

  live.effect('answers a command over the wire, and replays it when the hub resends it', () =>
    Effect.gen(function* () {
      const publications = yield* Queue.unbounded<Publication>()
      const completions = yield* Queue.unbounded<Completion>()
      const hub = yield* startHub(0, { publications, completions })
      const state = yield* SubscriptionRef.make(stateAt(0))
      const sent = yield* Queue.unbounded<SentRequest>()

      yield* Layer.build(
        Layer.provide(HubLink.layer, [
          yield* agentWith(state, sent),
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              CROOK_HUB_URL: `ws://${hub.url.host}${HUB_PATH}`,
              CROOK_HUB_TOKEN: 'exe0.vm-token',
            }),
          ),
        ]),
      )
      const answered = yield* Queue.take(completions)

      yield* Scope.close(hub.scope, Exit.void)
      yield* startHub(Number(hub.url.port), { publications, completions })
      const replayed = yield* Queue.take(completions)

      expect(answered).toEqual({ id: CommandId.make(0), result: delivered })
      expect(replayed).toEqual(answered)
      expect(yield* Queue.clear(sent)).toHaveLength(1)
    }),
  )
})
