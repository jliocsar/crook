import * as BunHttpServer from '@effect/platform-bun/BunHttpServer'
import * as BunSocket from '@effect/platform-bun/BunSocket'
import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Clock from 'effect/Clock'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as Schedule from 'effect/Schedule'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import * as RpcClient from 'effect/rpc/RpcClient'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import type * as Rpc from 'effect/rpc/Rpc'

import { CommandExecutor } from '@crook/agent/CommandExecutor'
import * as HubLink from '@crook/agent/HubLink'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { AgentRow } from '@crook/domain/AgentRow'
import { InputDelivered, Prompt, SendKeys } from '@crook/domain/Command'
import type { HerdView } from '@crook/domain/HerdView'
import { IdempotencyKey, MachineId, PaneId, TabId, WorkspaceId } from '@crook/domain/Ids'
import type { MachineConnection } from '@crook/domain/Machine'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import {
  BrowserLoginRequired,
  ExeDevIdentity,
  HubOriginInvalid,
  MachineUnidentified,
  OwnerEmailRejected,
  UpgradeOriginRejected,
} from '@crook/hub/ExeDevIdentity'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type SentRequest,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import { AgentPromptMethod } from '@crook/herdr/Methods'
import * as HttpRoutes from '@crook/hub/HttpRoutes'
import { AGENT_PING_INTERVAL, AgentLink, MachineIdMismatch } from '@crook/protocol/AgentLink'
import { ClientApi } from '@crook/protocol/ClientApi'
import {
  type CommandResult,
  MachineOffline,
  PaneNotAgent,
  type RoutedCommand,
} from '@crook/protocol/Commands'
import { protocolSerialization } from '@crook/protocol/Serialization'

const OWNER = 'owner@example.com'
const HUB_ORIGIN = 'https://my-hub.exe.xyz'
const EVIL_ORIGIN = 'https://evil.example'
const STRANGER = 'someone@example.com'

const ownerLogin = { 'X-ExeDev-Email': OWNER, Origin: HUB_ORIGIN }
const tokenContextOf = (machine: string) => ({
  'X-ExeDev-Token-Ctx': JSON.stringify({ machine }),
})
const agentToken = (machine: string) => ({ 'X-ExeDev-Email': OWNER, ...tokenContextOf(machine) })

const stateOf = (machine: MachineId, version: number) =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(version),
    workspaces: [],
    tabs: [],
    agents: [],
  })

const configFor = (origin: string) =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      CROOK_OWNER_EMAIL: OWNER,
      CROOK_HUB_ORIGIN: origin,
      CROOK_WEB_ROOT: `${import.meta.dirname}/web`,
    }),
  )

const testServer = BunHttpServer.layer({
  hostname: '127.0.0.1',
  port: 0,
  gracefulShutdownTimeout: Duration.zero,
  websocket: HttpRoutes.socketOptions,
})

const testClient = HttpServer.layerTestClient.pipe(Layer.provide(FetchHttpClient.layer))

const servedHub = Layer.mergeAll(
  HttpRouter.serve(HttpRoutes.layer, { disableLogger: true }),
  testClient,
).pipe(Layer.provideMerge(testServer))

const testHub = Layer.provide(servedHub, configFor(HUB_ORIGIN))

const socketUrl = (path: string) =>
  HttpServer.addressFormattedWith((address) =>
    Effect.succeed(`${address.replace(/^http/u, 'ws')}${path}`),
  )

const connect = Effect.fn('connect')(function* <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  path: string,
  headers: Record<string, string>,
  pingInterval: Duration.Duration = AGENT_PING_INTERVAL,
) {
  const url = yield* socketUrl(path)
  const protocol = yield* Layer.build(
    RpcClient.layerProtocolSocket({ pingInterval, retryPolicy: Schedule.recurs(0) }).pipe(
      Layer.provide([BunSocket.layerWebSocket(url, { headers }), protocolSerialization]),
    ),
  )

  return yield* RpcClient.make(group).pipe(Effect.provide(protocol))
})

const attachAs = Effect.fn('attachAs')(function* (
  machine: MachineId,
  pingInterval: Duration.Duration = AGENT_PING_INTERVAL,
) {
  const agent = yield* connect(AgentLink, HttpRoutes.AGENT_PATH, agentToken(machine), pingInterval)

  yield* agent.Attach().pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped)
  yield* agent.PublishState({ state: stateOf(machine, 1) })

  return agent
})

const get = (path: string, headers: Record<string, string> = {}) =>
  HttpClient.get(path, { headers }).pipe(
    Effect.flatMap((response) =>
      Effect.map(response.text, (body) => ({ status: response.status, body })),
    ),
  )

const rejectedWith = (rejection: { readonly message: string }) => ({
  status: 403,
  body: rejection.message,
})

const machineIn = (view: HerdView, id: MachineId) =>
  Arr.findFirst(view.machines, (entry) => entry.machine.id === id)

const herdWhere = Effect.fn('herdWhere')(function* (predicate: (view: HerdView) => boolean) {
  const phone = yield* connect(ClientApi, HttpRoutes.CLIENT_PATH, ownerLogin)

  return yield* phone
    .WatchHerd()
    .pipe(Stream.filter(predicate), Stream.runHead, Effect.flatMap(Effect.fromOption))
}, Effect.scoped)

const answeringAgent = Effect.fn('answeringAgent')(function* (
  machine: MachineId,
  answer: (routed: RoutedCommand) => CommandResult,
) {
  const agent = yield* connect(AgentLink, HttpRoutes.AGENT_PATH, agentToken(machine))

  yield* agent.Attach().pipe(
    Stream.runForEach((routed) => agent.CompleteCommand({ id: routed.id, result: answer(routed) })),
    Effect.ignore,
    Effect.forkScoped,
  )
  yield* agent.PublishState({ state: stateOf(machine, 1) })
})

const machineShows = (id: MachineId, connection: MachineConnection) =>
  herdWhere((view) =>
    Option.exists(machineIn(view, id), (entry) => entry.machine.connection === connection),
  )

layer(testHub, { excludeTestServices: true })('HttpRoutes', (live) => {
  live.effect('answers the health check without any exe.dev headers', () =>
    Effect.gen(function* () {
      expect(yield* get(HttpRoutes.HEALTH_PATH)).toEqual({ status: 200, body: 'ok' })
    }),
  )

  live.effect('serves the PWA to the owner logged in through a browser, and nobody else', () =>
    Effect.gen(function* () {
      const page = yield* get('/', ownerLogin)
      const deepLink = yield* get('/herd', { ...ownerLogin, Accept: 'text/html' })

      expect(page.body).toContain('<title>crook</title>')
      expect(deepLink.status).toBe(200)
      expect(yield* get('/')).toEqual(
        rejectedWith(new OwnerEmailRejected({ email: Option.none() })),
      )
      expect(yield* get('/', { 'X-ExeDev-Email': STRANGER })).toEqual(
        rejectedWith(new OwnerEmailRejected({ email: Option.some(STRANGER) })),
      )
      expect(yield* get('/', agentToken('laptop'))).toEqual(
        rejectedWith(new BrowserLoginRequired()),
      )
    }),
  )

  live.effect('refuses phone sockets from another origin, another login or an agent token', () =>
    Effect.gen(function* () {
      expect(yield* get(HttpRoutes.CLIENT_PATH, { ...ownerLogin, Origin: EVIL_ORIGIN })).toEqual(
        rejectedWith(new UpgradeOriginRejected({ origin: Option.some(EVIL_ORIGIN) })),
      )
      expect(yield* get(HttpRoutes.CLIENT_PATH, { 'X-ExeDev-Email': OWNER })).toEqual(
        rejectedWith(new UpgradeOriginRejected({ origin: Option.none() })),
      )
      expect(yield* get(HttpRoutes.CLIENT_PATH, { Origin: HUB_ORIGIN })).toEqual(
        rejectedWith(new OwnerEmailRejected({ email: Option.none() })),
      )
      expect(
        yield* get(HttpRoutes.CLIENT_PATH, { ...agentToken('laptop'), Origin: HUB_ORIGIN }),
      ).toEqual(rejectedWith(new BrowserLoginRequired()))
    }),
  )

  live.effect('refuses agent sockets without a machine id or minted by someone else', () =>
    Effect.gen(function* () {
      expect(yield* get(HttpRoutes.AGENT_PATH, { 'X-ExeDev-Email': OWNER })).toEqual(
        rejectedWith(new MachineUnidentified()),
      )
      expect(
        yield* get(HttpRoutes.AGENT_PATH, { 'X-ExeDev-Email': OWNER, 'X-ExeDev-Token-Ctx': '{}' }),
      ).toEqual(rejectedWith(new MachineUnidentified()))
      expect(
        yield* get(HttpRoutes.AGENT_PATH, { ...agentToken('laptop'), 'X-ExeDev-Email': STRANGER }),
      ).toEqual(rejectedWith(new OwnerEmailRejected({ email: Option.some(STRANGER) })))
    }),
  )

  live.effect('shows an attached agent online with its state, then offline when it drops', () =>
    Effect.gen(function* () {
      const laptop = MachineId.make('laptop')
      const online = yield* Effect.scoped(
        Effect.andThen(attachAs(laptop), machineShows(laptop, 'online')),
      )
      const offline = yield* machineShows(laptop, 'offline')

      expect(Option.flatMap(machineIn(online, laptop), (entry) => entry.state)).toEqual(
        Option.some(stateOf(laptop, 1)),
      )
      expect(Option.flatMap(machineIn(offline, laptop), (entry) => entry.state)).toEqual(
        Option.some(stateOf(laptop, 1)),
      )
    }),
  )

  live.effect('takes the machine from the upgrade, not from headers the agent sends per call', () =>
    Effect.gen(function* () {
      const laptop = MachineId.make('spoof-laptop')
      const impostor = MachineId.make('spoof-impostor')
      const agent = yield* connect(AgentLink, HttpRoutes.AGENT_PATH, agentToken(laptop))
      const mismatch = yield* agent
        .PublishState({ state: stateOf(impostor, 0) })
        .pipe(RpcClient.withHeaders(tokenContextOf(impostor)), Effect.flip)

      expect(mismatch).toEqual(
        new MachineIdMismatch({ connectedMachine: laptop, publishedMachine: impostor }),
      )
    }),
  )

  live.effect(
    'drops an agent that goes silent and keeps one that pings',
    () =>
      Effect.gen(function* () {
        const silent = MachineId.make('silent')
        const pinging = MachineId.make('pinging')

        yield* attachAs(silent, Duration.infinity)
        yield* attachAs(pinging)
        const silentSince = yield* Clock.currentTimeMillis
        yield* machineShows(silent, 'offline')
        const silentFor = Duration.millis((yield* Clock.currentTimeMillis) - silentSince)

        expect(Duration.isGreaterThanOrEqualTo(silentFor, HttpRoutes.SOCKET_SILENCE_TIMEOUT)).toBe(
          true,
        )
        expect(
          Option.map(
            machineIn(yield* herdWhere(() => true), pinging),
            (entry) => entry.machine.connection,
          ),
        ).toEqual(Option.some('online'))
      }),
    { timeout: Duration.toMillis(Duration.times(HttpRoutes.SOCKET_SILENCE_TIMEOUT, 2)) },
  )
})

layer(testHub, { excludeTestServices: true })('Commands through HttpRoutes', (live) => {
  const pane = PaneId.make('w1:p1')
  const key = IdempotencyKey.make('3f1c8a52-0b7e-4d0a-9a51-6f3f0d2f8e11')

  live.effect('relays a phone command to the agent of that machine and its answer back', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('command-laptop')

      yield* answeringAgent(machine, (routed) =>
        Match.value(routed.command).pipe(
          Match.tagsExhaustive({
            Prompt: (prompt) =>
              Result.succeed(new InputDelivered({ pane: prompt.pane, stateChangeSeq: 4 })),
            SendKeys: (sendKeys) => Result.fail(new PaneNotAgent({ pane: sendKeys.pane })),
          }),
        ),
      )
      const phone = yield* connect(ClientApi, HttpRoutes.CLIENT_PATH, ownerLogin)
      const receipt = yield* phone.SendCommand({
        machine,
        key,
        command: new Prompt({ pane, text: 'continue' }),
      })
      const refused = yield* phone
        .SendCommand({ machine, key, command: new SendKeys({ pane, keys: ['esc'] }) })
        .pipe(Effect.flip)

      expect(receipt).toEqual(new InputDelivered({ pane, stateChangeSeq: 4 }))
      expect(refused).toEqual(new PaneNotAgent({ pane }))
    }),
  )

  live.effect(
    'carries a phone command through the real agent to herdr, and replays the same key',
    () =>
      Effect.gen(function* () {
        const machine = MachineId.make('command-agent')
        const server = yield* HttpServer.HttpServer
        const state = yield* SubscriptionRef.make(
          new MachineState({
            machine,
            version: MachineStateVersion.make(1),
            workspaces: [],
            tabs: [],
            agents: [
              new AgentRow({
                pane,
                workspace: WorkspaceId.make('w1'),
                tab: TabId.make('w1:t1'),
                status: 'idle',
                title: 'EX-253 Example feature',
                cwd: '/home/jliocsar/Projects/crook',
                claudeSession: Option.none(),
                stateChangeSeq: 4,
                statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
              }),
            ],
          }),
        )
        const sent = yield* Queue.unbounded<SentRequest>()
        const herdr = HerdrClient.layerTest({
          responses: [scriptedResult(AgentPromptMethod, { type: 'agent_prompted' })],
          events: yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>(),
          sent,
        })
        const dialHub = connect(AgentLink, HttpRoutes.AGENT_PATH, agentToken(machine)).pipe(
          Effect.provideService(HttpServer.HttpServer, server),
        )

        yield* Layer.build(
          Layer.provide(
            HubLink.layerWith(dialHub),
            Layer.provideMerge(CommandExecutor.layer, [MachineStateSync.layerTest(state), herdr]),
          ),
        )
        yield* machineShows(machine, 'online')
        const phone = yield* connect(ClientApi, HttpRoutes.CLIENT_PATH, ownerLogin)
        const command = new Prompt({ pane, text: 'continue' })
        const receipt = yield* phone.SendCommand({ machine, key, command })
        const replayed = yield* phone.SendCommand({ machine, key, command })

        expect(receipt).toEqual(new InputDelivered({ pane, stateChangeSeq: 4 }))
        expect(replayed).toEqual(receipt)
        expect((yield* Queue.clear(sent)).map((request) => request.method)).toEqual([
          'agent.prompt',
        ])
      }),
  )

  live.effect('answers MachineOffline for a machine whose agent is not attached', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('command-nowhere')
      const phone = yield* connect(ClientApi, HttpRoutes.CLIENT_PATH, ownerLogin)
      const offline = yield* phone
        .SendCommand({ machine, key, command: new Prompt({ pane, text: 'continue' }) })
        .pipe(Effect.flip)

      expect(offline).toEqual(new MachineOffline({ machine }))
    }),
  )
})

layer(Layer.empty)('ExeDevIdentity', (it) => {
  it.effect('refuses to start with a CROOK_HUB_ORIGIN that is not an https address', () =>
    Effect.gen(function* () {
      const failure = yield* Layer.build(
        Layer.provide(ExeDevIdentity.layer, configFor('my-hub.exe.xyz:8000')),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(HubOriginInvalid)
    }),
  )
})
