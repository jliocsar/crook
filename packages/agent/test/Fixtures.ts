import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as DateTime from 'effect/DateTime'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type * as SubscriptionRef from 'effect/SubscriptionRef'

import { CommandExecutor } from '@crook/agent/CommandExecutor'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { AgentRow } from '@crook/domain/AgentRow'
import { MachineId, PaneId, TabId, WorkspaceId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import type { HerdrClient } from '@crook/herdr/HerdrClient'
import { AgentInfo, SessionSnapshot, TabInfo, WorkspaceInfo } from '@crook/herdr/Records'

export const workspaceInfo = new WorkspaceInfo({
  workspace_id: 'w1',
  number: 1,
  label: 'crook',
  focused: true,
  pane_count: 1,
  tab_count: 1,
  active_tab_id: 'w1:t1',
  agent_status: 'working',
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

export const sessionSnapshot = (agents: readonly AgentInfo[]) =>
  new SessionSnapshot({
    version: '0.9.1',
    protocol: 22,
    focused_workspace_id: Option.none(),
    focused_tab_id: Option.none(),
    focused_pane_id: Option.none(),
    workspaces: [workspaceInfo],
    tabs: [tabInfo],
    panes: [],
    agents,
  })

export const LAPTOP = MachineId.make('laptop')

export const agentRow = (fields: Partial<ConstructorParameters<typeof AgentRow>[0]> = {}) =>
  new AgentRow({
    pane: PaneId.make('w1:p1'),
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    status: 'idle',
    title: 'EX-253 Example feature',
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq: 4,
    statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
    ...fields,
  })

export const machineStateWith = (agents: readonly AgentRow[]) =>
  new MachineState({
    machine: LAPTOP,
    version: MachineStateVersion.make(0),
    herdrVersion: '0.9.1',
    workspaces: [],
    tabs: [],
    agents,
  })

export const executorWith = (
  herdr: Layer.Layer<HerdrClient>,
  state: SubscriptionRef.SubscriptionRef<MachineState>,
) => Layer.provideMerge(CommandExecutor.layer, [MachineStateSync.layerTest(state), herdr])

export const linkedAgentWith = (
  herdr: Layer.Layer<HerdrClient>,
  state: SubscriptionRef.SubscriptionRef<MachineState>,
) =>
  Layer.provideMerge(Layer.mergeAll(CommandExecutor.layer, TranscriptStreams.layerAt([])), [
    MachineStateSync.layerTest(state),
    herdr,
    BunFileSystem.layer,
    Path.layer,
  ])
