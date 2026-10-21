import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'
import * as Struct from 'effect/Struct'

import { AgentRow, StatusBeforeHandoff } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
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
import type { Place } from '@crook/domain/Place'
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
  readonly createdPanes: HashSet.HashSet<PaneId>
  readonly places: readonly Place[]
}

interface MachineStateContents {
  readonly herdrVersion: string
  readonly herdr: HerdrLink
  readonly workspaces: readonly Workspace[]
  readonly tabs: readonly Tab[]
  readonly panes: readonly Pane[]
  readonly agents: readonly AgentRow[]
  readonly places: readonly Place[]
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
  new StatusBeforeHandoff({
    status: row.status,
    statusChangedAt: row.statusChangedAt,
    terminal: row.terminal,
    stateChangeSeq: row.stateChangeSeq,
  })

const carriedBeforeHandoff = (previous: Option.Option<AgentRow>, info: AgentInfo) =>
  Option.flatMap(previous, (row) =>
    Option.orElse(row.beforeHandoff, () =>
      Option.liftPredicate(row, isHandedOffFrom(info)).pipe(Option.map(statusBeforeHandoffOf)),
    ),
  )

const isNotYetDetected = (info: AgentInfo) =>
  info.agent_status === 'unknown' || info.state_change_seq === 0

const isTabInView = (tabs: readonly TabInfo[], info: AgentInfo) =>
  Arr.some(tabs, (tab) => tab.tab_id === info.tab_id && tab.focused)

const isLostCompletion = (
  carried: Option.Option<StatusBeforeHandoff>,
  tabs: readonly TabInfo[],
  info: AgentInfo,
) =>
  info.agent_status === 'idle' &&
  Option.exists(carried, (before) => before.status === 'done') &&
  !isTabInView(tabs, info)

const keptBeforeHandoff = (carried: Option.Option<StatusBeforeHandoff>, status: AgentStatus) =>
  Option.filter(carried, (before) => status === 'unknown' || status === before.status)

const publishedStatus = (
  carried: Option.Option<StatusBeforeHandoff>,
  tabs: readonly TabInfo[],
  info: AgentInfo,
): AgentStatus => {
  if (isNotYetDetected(info)) {
    return 'unknown'
  }

  return isLostCompletion(carried, tabs, info) ? 'done' : info.agent_status
}

const statusChangedAt = (
  previous: Option.Option<AgentRow>,
  carried: Option.Option<StatusBeforeHandoff>,
  status: AgentStatus,
  now: DateTime.Utc,
): DateTime.Utc =>
  Option.firstSomeOf([
    Option.filter(previous, (previousRow) => previousRow.status === status),
    Option.filter(carried, (before) => before.status === status),
  ]).pipe(Option.match({ onNone: () => now, onSome: (since) => since.statusChangedAt }))

export const workingDirectoryOf = (info: AgentInfo): Option.Option<string> =>
  Option.orElse(info.foreground_cwd, () => info.cwd)

export const paneLabel = (pane: PaneInfo): Option.Option<string> =>
  pane.label.pipe(Option.map(Str.trim), Option.filter(Str.isNonEmpty))

const labelIn = (panes: readonly PaneInfo[]) => (info: AgentInfo) =>
  Arr.findFirst(panes, (pane) => pane.pane_id === info.pane_id).pipe(Option.flatMap(paneLabel))

const toAgentRow =
  (previousAgents: readonly AgentRow[], reading: Omit<HerdReading, 'places'>, now: DateTime.Utc) =>
  (resolved: ResolvedAgent) => {
    const { info, claudeSession, branch } = resolved
    const previous = previousRowOf(previousAgents, resolved)
    const carried = carriedBeforeHandoff(previous, info)
    const status = publishedStatus(carried, reading.tabs, info)

    return new AgentRow({
      pane: PaneId.make(info.pane_id),
      workspace: WorkspaceId.make(info.workspace_id),
      tab: TabId.make(info.tab_id),
      terminal: TerminalId.make(info.terminal_id),
      status,
      title: Option.firstSomeOf([info.terminal_title_stripped, info.title, info.name]).pipe(
        Option.getOrElse(() => ''),
      ),
      label: labelIn(reading.panes)(info),
      createdByCrook: HashSet.has(reading.createdPanes, PaneId.make(info.pane_id)),
      cwd: Option.getOrElse(workingDirectoryOf(info), () => ''),
      branch,
      claudeSession,
      stateChangeSeq: info.state_change_seq,
      statusChangedAt: statusChangedAt(previous, carried, status, now),
      beforeHandoff: keptBeforeHandoff(carried, status),
    })
  }

export const agentRowsOf = (
  previousAgents: readonly AgentRow[],
  reading: Omit<HerdReading, 'places'>,
  now: DateTime.Utc,
): readonly AgentRow[] => reading.agents.map(toAgentRow(previousAgents, reading, now))

const herdContents = (
  previousAgents: readonly AgentRow[],
  connection: HerdrConnectionId,
  reading: HerdReading,
  now: DateTime.Utc,
): MachineStateContents => ({
  herdrVersion: reading.herdrVersion,
  herdr: new HerdrLink({ connection, lostAt: Option.none() }),
  workspaces: reading.workspaces.map(toWorkspace),
  tabs: reading.tabs.map(toTab),
  panes: reading.panes.map(toPane),
  agents: agentRowsOf(previousAgents, reading, now),
  places: reading.places,
})

const withChangedContents = (
  previous: MachineState,
  contents: MachineStateContents,
): Option.Option<MachineState> =>
  Option.liftPredicate(
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
): Option.Option<MachineState> =>
  withChangedContents(previous, herdContents(previous.agents, connection, reading, now))

export const withCreatedPanes = (
  previous: MachineState,
  createdPanes: HashSet.HashSet<PaneId>,
): Option.Option<MachineState> =>
  withChangedContents(previous, {
    herdrVersion: previous.herdrVersion,
    herdr: previous.herdr,
    workspaces: previous.workspaces,
    tabs: previous.tabs,
    panes: previous.panes,
    agents: previous.agents.map(
      (row) =>
        new AgentRow(
          Struct.evolve(row, { createdByCrook: () => HashSet.has(createdPanes, row.pane) }),
        ),
    ),
    places: previous.places,
  })

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
          places: state.places,
        }),
    ),
  )
