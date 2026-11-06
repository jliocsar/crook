import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunHttpServer from '@effect/platform-bun/BunHttpServer'
import * as BunSocket from '@effect/platform-bun/BunSocket'
import * as ConfigProvider from 'effect/ConfigProvider'
import type * as Context from 'effect/Context'
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
import type * as HttpClient from 'effect/http/HttpClient'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServer from 'effect/http/HttpServer'
import * as RpcClient from 'effect/rpc/RpcClient'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import type * as Rpc from 'effect/rpc/Rpc'
import type * as SqlClient from 'effect/sql/SqlClient'

import * as AgentDaemon from '@crook/agent/AgentDaemon'
import { AuditLog } from '@crook/agent/AuditLog'
import { ClaudeSessionFiles } from '@crook/agent/ClaudeSessionFiles'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { HubConnectionStatus } from '@crook/agent/HubConnectionStatus'
import * as HubLink from '@crook/agent/HubLink'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
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
import { Workspace } from '@crook/domain/Workspace'
import type { HerdrClient } from '@crook/herdr/HerdrClient'
import * as Database from '@crook/hub/Database'
import { HarkClient } from '@crook/hub/HarkClient'
import * as HubDaemon from '@crook/hub/HubDaemon'
import { NotificationStore } from '@crook/hub/NotificationStore'
import { AgentLink, Hello } from '@crook/protocol/AgentLink'
import { LINK_PING_INTERVAL } from '@crook/protocol/LinkTiming'
import { ClientApi } from '@crook/protocol/ClientApi'
import { AGENT_PATH, CLIENT_PATH } from '@crook/protocol/HubRoutes'
import { protocolSerialization } from '@crook/protocol/Serialization'

import { tokenConfig } from './HarkFakes'

export type AgentFoundation =
  | MachineStateSync
  | ClaudeSessionFiles
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
    runningSubagents: Option.none(),
    claudeWaiting: Option.none(),
    ...fields,
  })

export const crookWorkspace = new Workspace({ id: WorkspaceId.make('w1'), label: 'crook' })

export const herdrLinkOf = (connection: number, lostAt = Option.none<DateTime.Utc>()) =>
  new HerdrLink({ connection: HerdrConnectionId.make(connection), lostAt })

export const machineStateWith = (
  machine: MachineId,
  version: number,
  agents: readonly AgentRow[],
  fields: Partial<Pick<ConstructorParameters<typeof MachineState>[0], 'workspaces' | 'herdr'>> = {},
) =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(version),
    herdrVersion: '0.9.1',
    herdr: herdrLinkOf(1),
    workspaces: [],
    tabs: [],
    panes: [],
    agents,
    places: [],
    ...fields,
  })

export const harkServicesUnder = <Services, Failure, Needs>(
  services: Layer.Layer<Services, Failure, Needs>,
  http: Layer.Layer<HttpClient.HttpClient>,
  token: Option.Option<string>,
  database: Context.Context<SqlClient.SqlClient>,
) => {
  const harkServices = Layer.provideMerge(
    Layer.mergeAll(HarkClient.layer, NotificationStore.layer),
    HubDaemon.herdServices,
  )

  return Layer.provideMerge(services, harkServices).pipe(
    Layer.provide([http, tokenConfig(token), Layer.succeedContext(database)]),
  )
}

export const configFor = (origin: string, more: Record<string, string> = {}) =>
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      CROOK_OWNER_EMAIL: OWNER,
      CROOK_HUB_ORIGIN: origin,
      CROOK_WEB_ROOT: `${import.meta.dirname}/web`,
      ...more,
    }),
  )

const testServer = BunHttpServer.layer({
  hostname: '127.0.0.1',
  port: 0,
  gracefulShutdownTimeout: Duration.zero,
  websocket: HubDaemon.socketOptions,
})

const testClient = HttpServer.layerTestClient.pipe(Layer.provide(FetchHttpClient.layer))

const servedHub = (hark: Layer.Layer<HttpClient.HttpClient>) =>
  Layer.mergeAll(
    HttpRouter.serve(HubDaemon.routesOver(hark), { disableLogger: true }),
    testClient,
  ).pipe(Layer.provideMerge(testServer))

export const testHub = Layer.provideMerge(
  Layer.provide(servedHub(FetchHttpClient.layer), configFor(HUB_ORIGIN)),
  Database.layerAt(IN_MEMORY),
)

export const hubOverHark = (hark: Layer.Layer<HttpClient.HttpClient>, token: string) =>
  Layer.provideMerge(
    Layer.provide(servedHub(hark), configFor(HUB_ORIGIN, { CROOK_HUB_HARK_TOKEN: token })),
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
  pingInterval: Duration.Duration = LINK_PING_INTERVAL,
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
        AgentDaemon.commandExecution,
        AgentDaemon.transcriptStreamingAt(claudeRoots),
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
      ClaudeSessionFiles.layerTest(),
      CreatedPanes.layerTest(),
      discardingAgentAudit,
      herdr,
      Layer.provide(GitBranches.layer, [BunFileSystem.layer, Path.layer]),
      BunFileSystem.layer,
      Path.layer,
    ),
    claudeRoots,
  )
