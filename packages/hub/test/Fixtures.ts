import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer'
import * as BunSocket from '@effect/platform-bun/BunSocket'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import type * as SubscriptionRef from 'effect/SubscriptionRef'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import * as RpcClient from 'effect/rpc/RpcClient'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import type * as Rpc from 'effect/rpc/Rpc'

import { AuditLog } from '@crook/agent/AuditLog'
import { CommandExecutor } from '@crook/agent/CommandExecutor'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { HubConnectionStatus } from '@crook/agent/HubConnection'
import * as HubLink from '@crook/agent/HubLink'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { AgentRow } from '@crook/domain/AgentRow'
import { PermissionAsk, RunCommand } from '@crook/domain/Ask'
import { herdViews } from '@crook/domain/HerdUpdate'
import { findMachine } from '@crook/domain/HerdView'
import type { HerdView } from '@crook/domain/HerdView'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  AskId,
  HerdrConnectionId,
  type MachineId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from '@crook/domain/Ids'
import type { MachineConnection } from '@crook/domain/Machine'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import type { HerdrClient } from '@crook/herdr/HerdrClient'
import * as Database from '@crook/hub/Database'
import * as HttpRoutes from '@crook/hub/HttpRoutes'
import { AGENT_PING_INTERVAL, AgentLink, Hello } from '@crook/protocol/AgentLink'
import { ClientApi } from '@crook/protocol/ClientApi'
import { AGENT_PATH, CLIENT_PATH } from '@crook/protocol/HubRoutes'
import { protocolSerialization } from '@crook/protocol/Serialization'

export type AgentFoundation =
  | MachineStateSync
  | CreatedPanes
  | AuditLog
  | HerdrClient
  | GitBranches
  | FileSystem.FileSystem
  | Path.Path

export const OWNER = 'owner@example.com'
export const HUB_ORIGIN = 'https://my-hub.exe.xyz'
export const IN_MEMORY = ':memory:'
export const PANE = PaneId.make('w1:p1')
export const BASH_COMMAND = 'rm -rf build && bun run build'

export const bashAsk = (id: string) =>
  new PermissionAsk({
    id: AskId.make(id),
    source: 'hook',
    tool: 'Bash',
    plugin: Option.none(),
    action: new RunCommand({ command: BASH_COMMAND }),
    options: [],
    dialog: Option.none(),
  })

export const hello = new Hello({ agentVersion: '0.0.9', label: Option.none() })

export const ownerLogin = { 'X-ExeDev-Email': OWNER, Origin: HUB_ORIGIN }

export const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

export const tokenContextOf = (machine: string) => ({
  'X-ExeDev-Token-Ctx': encodeJson({ machine }),
})

export const agentToken = (machine: string) => ({
  'X-ExeDev-Email': OWNER,
  ...tokenContextOf(machine),
})

export const agentRow = (fields: Partial<ConstructorParameters<typeof AgentRow>[0]> = {}) =>
  new AgentRow({
    pane: PANE,
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    terminal: TerminalId.make('term_1'),
    status: 'done',
    title: 'EX-253 Example feature',
    label: Option.none(),
    createdByCrook: false,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq: 7,
    statusChangedAt: DateTime.makeUnsafe(0),
    beforeHandoff: Option.none(),
    ask: Option.none(),
    ...fields,
  })

export const machineStateWith = (
  machine: MachineId,
  version: number,
  agents: readonly AgentRow[],
) =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(version),
    herdrVersion: '0.9.1',
    herdr: new HerdrLink({ connection: HerdrConnectionId.make(1), lostAt: Option.none() }),
    workspaces: [],
    tabs: [],
    panes: [],
    agents,
    places: [],
  })

export const configFor = (origin: string) =>
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

export const testHub = Layer.provideMerge(
  Layer.provide(servedHub, configFor(HUB_ORIGIN)),
  Database.layerAt(IN_MEMORY),
)

export const discardingAgentAudit = Layer.succeed(
  AuditLog,
  AuditLog.of({ record: () => Effect.void }),
)

const socketUrl = (path: string) =>
  HttpServer.addressFormattedWith((address) =>
    Effect.succeed(`${address.replace(/^http/u, 'ws')}${path}`),
  )

export const connect = Effect.fn('connect')(function* <Rpcs extends Rpc.Any>(
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

export const herdWhere = Effect.fn('herdWhere')(function* (predicate: (view: HerdView) => boolean) {
  const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)

  return yield* phone
    .WatchHerd()
    .pipe(herdViews, Stream.filter(predicate), Stream.runHead, Effect.flatMap(Effect.fromOption))
}, Effect.scoped)

export const machineShows = (id: MachineId, connection: MachineConnection) =>
  herdWhere((view) =>
    Option.exists(findMachine(view, id), (entry) => entry.machine.connection === connection),
  )

export const hubDialFor = (machine: MachineId) =>
  Effect.map(Effect.service(HttpServer.HttpServer), (server) =>
    connect(AgentLink, AGENT_PATH, agentToken(machine)).pipe(
      Effect.provideService(HttpServer.HttpServer, server),
    ),
  )

export const agentOver = Effect.fn('agentOver')(function* <Failure>(
  machine: MachineId,
  foundation: Layer.Layer<AgentFoundation, Failure>,
  claudeRoots: readonly string[],
) {
  return Layer.provide(
    HubLink.layerWith(yield* hubDialFor(machine), hello),
    Layer.provideMerge(
      Layer.mergeAll(
        CommandExecutor.layer,
        TranscriptStreams.layerAt(claudeRoots),
        HubConnectionStatus.layer,
      ),
      foundation,
    ),
  )
})

export const realAgent = (
  machine: MachineId,
  state: SubscriptionRef.SubscriptionRef<MachineState>,
  herdr: Layer.Layer<HerdrClient>,
  claudeRoots: readonly string[],
) =>
  agentOver(
    machine,
    Layer.mergeAll(
      MachineStateSync.layerTest(state),
      CreatedPanes.layerTest(),
      discardingAgentAudit,
      herdr,
      Layer.provide(GitBranches.layer, [BunFileSystem.layer, Path.layer]),
      BunFileSystem.layer,
      Path.layer,
    ),
    claudeRoots,
  )
