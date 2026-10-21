import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type * as SubscriptionRef from 'effect/SubscriptionRef'

import { AuditLog } from '@crook/agent/AuditLog'
import { CommandExecutor } from '@crook/agent/CommandExecutor'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { AgentRow } from '@crook/domain/AgentRow'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  HerdrConnectionId,
  MachineId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from '@crook/domain/Ids'
import { AuditPolicy, DEFAULT_AUDIT_ARGUMENT_LIMIT } from '@crook/domain/Audit'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import type { HerdrClient } from '@crook/herdr/HerdrClient'
import { AgentInfo, PaneInfo, SessionSnapshot, TabInfo, WorkspaceInfo } from '@crook/herdr/Records'

export interface ExecutorOptions {
  readonly created?: Iterable<PaneId>
  readonly invalidate?: Effect.Effect<void>
  readonly audit?: Layer.Layer<AuditLog>
}

export const workspaceInfo = new WorkspaceInfo({
  workspace_id: 'w1',
  number: 1,
  label: 'crook',
  focused: true,
  pane_count: 1,
  tab_count: 1,
  active_tab_id: 'w1:t1',
  agent_status: 'working',
  worktree: Option.none(),
})

export const tabInfo = new TabInfo({
  tab_id: 'w1:t1',
  workspace_id: 'w1',
  number: 1,
  label: '1 · claude',
  focused: true,
  pane_count: 1,
  agent_status: 'working',
})

export const agentInfo = (fields: Partial<ConstructorParameters<typeof AgentInfo>[0]> = {}) =>
  new AgentInfo({
    pane_id: 'w1:p1',
    terminal_id: 'term_1',
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: true,
    revision: 3,
    agent_status: 'working',
    state_change_seq: 14162,
    completion_seq: Option.none(),
    name: Option.none(),
    agent: Option.some('claude'),
    display_agent: Option.some('claude'),
    agent_session: Option.none(),
    title: Option.none(),
    terminal_title: Option.some('◑ EX-253 Example feature'),
    terminal_title_stripped: Option.some('EX-253 Example feature'),
    cwd: Option.some('/home/jliocsar/Projects/crook'),
    foreground_cwd: Option.none(),
    ...fields,
  })

export const paneInfo = (fields: Partial<ConstructorParameters<typeof PaneInfo>[0]> = {}) =>
  new PaneInfo({
    pane_id: 'w1:p1',
    terminal_id: 'term_1',
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: true,
    revision: 3,
    agent_status: 'unknown',
    agent: Option.none(),
    display_agent: Option.none(),
    agent_session: Option.none(),
    label: Option.none(),
    title: Option.none(),
    terminal_title: Option.none(),
    cwd: Option.some('/home/jliocsar/Projects/crook'),
    foreground_cwd: Option.none(),
    ...fields,
  })

const paneOf = (agent: AgentInfo) =>
  paneInfo({
    pane_id: agent.pane_id,
    terminal_id: agent.terminal_id,
    workspace_id: agent.workspace_id,
    tab_id: agent.tab_id,
    agent_status: agent.agent_status,
    agent: agent.agent,
  })

export const sessionSnapshot = (
  agents: readonly AgentInfo[],
  panes: readonly PaneInfo[] = agents.map(paneOf),
  tabs: readonly TabInfo[] = [tabInfo],
) =>
  new SessionSnapshot({
    version: '0.9.1',
    protocol: 22,
    focused_workspace_id: Option.none(),
    focused_tab_id: Option.none(),
    focused_pane_id: Option.none(),
    workspaces: [workspaceInfo],
    tabs,
    panes,
    agents,
  })

export const LAPTOP = MachineId.make('laptop')
export const TERMINAL = TerminalId.make('term_1')

export const herdrLink = new HerdrLink({
  connection: HerdrConnectionId.make(1),
  lostAt: Option.none(),
})

export const agentRow = (fields: Partial<ConstructorParameters<typeof AgentRow>[0]> = {}) =>
  new AgentRow({
    pane: PaneId.make('w1:p1'),
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    terminal: TERMINAL,
    status: 'idle',
    title: 'EX-253 Example feature',
    label: Option.none(),
    createdByCrook: false,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq: 4,
    statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
    beforeHandoff: Option.none(),
    ...fields,
  })

export const machineStateWith = (agents: readonly AgentRow[]) =>
  new MachineState({
    machine: LAPTOP,
    version: MachineStateVersion.make(0),
    herdrVersion: '0.9.1',
    herdr: herdrLink,
    workspaces: [],
    tabs: [],
    panes: [],
    agents,
    places: [],
  })

export const AUDIT_EVERYTHING = new AuditPolicy({
  argumentLimit: DEFAULT_AUDIT_ARGUMENT_LIMIT,
  redactedArguments: [],
})

export const discardingAudit = Layer.succeed(AuditLog, AuditLog.of({ record: () => Effect.void }))

export const gitBranchesOnDisk = Layer.provide(GitBranches.layer, [BunFileSystem.layer, Path.layer])

export const executorWith = (
  herdr: Layer.Layer<HerdrClient>,
  state: SubscriptionRef.SubscriptionRef<MachineState>,
  options: ExecutorOptions = {},
) =>
  Layer.provideMerge(CommandExecutor.layer, [
    MachineStateSync.layerTest(state, options.invalidate),
    CreatedPanes.layerTest(options.created),
    options.audit ?? discardingAudit,
    herdr,
    gitBranchesOnDisk,
    BunFileSystem.layer,
  ])

export const linkedAgentWith = (
  herdr: Layer.Layer<HerdrClient>,
  state: SubscriptionRef.SubscriptionRef<MachineState>,
  options: ExecutorOptions = {},
) =>
  Layer.provideMerge(Layer.mergeAll(CommandExecutor.layer, TranscriptStreams.layerAt([])), [
    MachineStateSync.layerTest(state, options.invalidate),
    CreatedPanes.layerTest(options.created),
    options.audit ?? discardingAudit,
    herdr,
    gitBranchesOnDisk,
    BunFileSystem.layer,
    Path.layer,
  ])
