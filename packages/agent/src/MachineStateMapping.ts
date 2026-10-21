import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Schema from 'effect/Schema'

import { AgentRow, StatusBeforeHandoff } from '@crook/domain/AgentRow'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  type ClaudeSessionId,
  type HerdrConnectionId,
  type MachineId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from '@crook/domain/Ids'
import { MachineState, MachineStateVersion, isHerdrLost } from '@crook/domain/MachineState'
import { Pane } from '@crook/domain/Pane'
import { Tab } from '@crook/domain/Tab'
import { Workspace } from '@crook/domain/Workspace'
import type { AgentInfo, PaneInfo, TabInfo, WorkspaceInfo } from '@crook/herdr/Records'

export interface ResolvedAgent {
  readonly info: AgentInfo
  readonly claudeSession: Option.Option<ClaudeSessionId>
  readonly branch: Option.Option<string>
}

export interface HerdReading {
  readonly herdrVersion: string
  readonly workspaces: readonly WorkspaceInfo[]
  readonly tabs: readonly TabInfo[]
  readonly panes: readonly PaneInfo[]
  readonly agents: readonly ResolvedAgent[]
}

const isSameMachineState = Schema.toEquivalence(MachineState)

const toWorkspace = (info: WorkspaceInfo) =>
  new Workspace({ id: WorkspaceId.make(info.workspace_id), label: info.label })

const toTab = (info: TabInfo) =>
  new Tab({
    id: TabId.make(info.tab_id),
    workspace: WorkspaceId.make(info.workspace_id),
    label: info.label,
  })

const toPane = (info: PaneInfo) =>
  new Pane({
    id: PaneId.make(info.pane_id),
    workspace: WorkspaceId.make(info.workspace_id),
    tab: TabId.make(info.tab_id),
  })

const isSameAgent =
  ({ info, claudeSession }: ResolvedAgent) =>
  (row: AgentRow) =>
    row.terminal === info.terminal_id ||
    Option.exists(row.claudeSession, (session) => Option.contains(claudeSession, session))

const previousRowOf = (previousAgents: readonly AgentRow[], resolved: ResolvedAgent) =>
  Arr.findFirst(previousAgents, (row) => row.pane === resolved.info.pane_id).pipe(
    Option.filter(isSameAgent(resolved)),
  )

const isHandedOffFrom = (info: AgentInfo) => (row: AgentRow) =>
  row.terminal !== info.terminal_id && row.status !== 'unknown'

const statusBeforeHandoffOf = (row: AgentRow) =>
  new StatusBeforeHandoff({ status: row.status, statusChangedAt: row.statusChangedAt })

const beforeHandoffOf = (previous: Option.Option<AgentRow>, info: AgentInfo) =>
  info.agent_status === 'unknown'
    ? Option.flatMap(previous, (row) =>
        Option.orElse(row.beforeHandoff, () =>
          Option.liftPredicate(row, isHandedOffFrom(info)).pipe(Option.map(statusBeforeHandoffOf)),
        ),
      )
    : Option.none()

const statusChangedAt = (
  previous: Option.Option<AgentRow>,
  info: AgentInfo,
  now: DateTime.Utc,
): DateTime.Utc =>
  previous.pipe(
    Option.flatMap((row) =>
      Option.orElse(
        Option.liftPredicate(row, (same) => same.status === info.agent_status),
        () => Option.filter(row.beforeHandoff, (before) => before.status === info.agent_status),
      ),
    ),
    Option.match({ onNone: () => now, onSome: (since) => since.statusChangedAt }),
  )

export const workingDirectoryOf = (info: AgentInfo): Option.Option<string> =>
  Option.orElse(info.foreground_cwd, () => info.cwd)

const toAgentRow =
  (previousAgents: readonly AgentRow[], now: DateTime.Utc) => (resolved: ResolvedAgent) => {
    const { info, claudeSession, branch } = resolved
    const previous = previousRowOf(previousAgents, resolved)

    return new AgentRow({
      pane: PaneId.make(info.pane_id),
      workspace: WorkspaceId.make(info.workspace_id),
      tab: TabId.make(info.tab_id),
      terminal: TerminalId.make(info.terminal_id),
      status: info.agent_status,
      title: Option.firstSomeOf([info.terminal_title_stripped, info.title, info.name]).pipe(
        Option.getOrElse(() => ''),
      ),
      cwd: Option.getOrElse(workingDirectoryOf(info), () => ''),
      branch,
      claudeSession,
      stateChangeSeq: info.state_change_seq,
      statusChangedAt: statusChangedAt(previous, info, now),
      beforeHandoff: beforeHandoffOf(previous, info),
    })
  }

const herdContents = (
  previousAgents: readonly AgentRow[],
  connection: HerdrConnectionId,
  reading: HerdReading,
  now: DateTime.Utc,
) => ({
  herdrVersion: reading.herdrVersion,
  herdr: new HerdrLink({ connection, lostAt: Option.none() }),
  workspaces: reading.workspaces.map(toWorkspace),
  tabs: reading.tabs.map(toTab),
  panes: reading.panes.map(toPane),
  agents: reading.agents.map(toAgentRow(previousAgents, now)),
})

export const initialMachineState = (
  machine: MachineId,
  connection: HerdrConnectionId,
  reading: HerdReading,
  now: DateTime.Utc,
): MachineState =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(0),
    ...herdContents([], connection, reading, now),
  })

export const nextMachineState = (
  previous: MachineState,
  connection: HerdrConnectionId,
  reading: HerdReading,
  now: DateTime.Utc,
): Option.Option<MachineState> => {
  const contents = herdContents(previous.agents, connection, reading, now)

  return Option.liftPredicate(
    new MachineState({ machine: previous.machine, version: previous.version, ...contents }),
    (candidate) => !isSameMachineState(candidate, previous),
  ).pipe(
    Option.map(
      () =>
        new MachineState({
          machine: previous.machine,
          version: MachineStateVersion.make(previous.version + 1),
          ...contents,
        }),
    ),
  )
}

export const herdrLostState = (
  previous: MachineState,
  now: DateTime.Utc,
): Option.Option<MachineState> =>
  Option.liftPredicate(previous, Predicate.not(isHerdrLost)).pipe(
    Option.map(
      (state) =>
        new MachineState({
          machine: state.machine,
          version: MachineStateVersion.make(state.version + 1),
          herdrVersion: state.herdrVersion,
          herdr: new HerdrLink({ connection: state.herdr.connection, lostAt: Option.some(now) }),
          workspaces: state.workspaces,
          tabs: state.tabs,
          panes: state.panes,
          agents: state.agents,
        }),
    ),
  )
