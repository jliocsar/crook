import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'
import * as Struct from 'effect/Struct'

import type { RunningCounts } from '@crook/agent/RunningSubagents'
import { AgentRow, StatusBeforeHandoff } from '@crook/domain/AgentRow'
import type { Ask } from '@crook/domain/Ask'
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
  readonly ask: Option.Option<Ask>
  readonly claudeWaiting: Option.Option<boolean>
}

export interface HerdReading {
  readonly herdrVersion: string
  readonly workspaces: readonly WorkspaceInfo[]
  readonly tabs: readonly TabInfo[]
  readonly panes: readonly PaneInfo[]
  readonly agents: readonly ResolvedAgent[]
  readonly createdPanes: HashSet.HashSet<PaneId>
  readonly runningSubagents: RunningCounts
}

export interface HerdContents {
  readonly herdrVersion: string
  readonly herdr: HerdrLink
  readonly workspaces: readonly Workspace[]
  readonly tabs: readonly Tab[]
  readonly panes: readonly Pane[]
  readonly agents: readonly AgentRow[]
}

export interface MachineStateContents extends HerdContents {
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

export const workingDirectoryOf = ({
  foreground_cwd,
  cwd,
}: Pick<PaneInfo, 'foreground_cwd' | 'cwd'>): Option.Option<string> =>
  Option.orElse(foreground_cwd, () => cwd)

export const paneLabel = (pane: PaneInfo): Option.Option<string> =>
  pane.label.pipe(Option.map(Str.trim), Option.filter(Str.isNonEmpty))

const labelIn = (panes: readonly PaneInfo[]) => (info: AgentInfo) =>
  Arr.findFirst(panes, (pane) => pane.pane_id === info.pane_id).pipe(Option.flatMap(paneLabel))

const runningIn = (counts: RunningCounts, claudeSession: Option.Option<ClaudeSessionId>) =>
  Option.flatMap(claudeSession, (session) => HashMap.get(counts, session))

const toAgentRow =
  (previousAgents: readonly AgentRow[], reading: HerdReading, now: DateTime.Utc) =>
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
      ask: Option.filter(resolved.ask, () => status === 'blocked'),
      runningSubagents: runningIn(reading.runningSubagents, claudeSession),
      claudeWaiting: resolved.claudeWaiting,
    })
  }

export const herdContents = (
  previousAgents: readonly AgentRow[],
  connection: HerdrConnectionId,
  reading: HerdReading,
  now: DateTime.Utc,
): HerdContents => ({
  herdrVersion: reading.herdrVersion,
  herdr: new HerdrLink({ connection, lostAt: Option.none() }),
  workspaces: reading.workspaces.map(toWorkspace),
  tabs: reading.tabs.map(toTab),
  panes: reading.panes.map(toPane),
  agents: reading.agents.map(toAgentRow(previousAgents, reading, now)),
})

const bumpedIfChanged = (
  previous: MachineState,
  candidate: MachineState,
): Option.Option<MachineState> =>
  Option.liftPredicate(candidate, (changed) => !isSameMachineState(changed, previous)).pipe(
    Option.map(
      (changed) =>
        new MachineState(
          Struct.evolve(changed, { version: (version) => MachineStateVersion.make(version + 1) }),
        ),
    ),
  )

export const initialMachineState = (
  machine: MachineId,
  contents: MachineStateContents,
): MachineState => new MachineState({ machine, version: MachineStateVersion.make(0), ...contents })

export const machineStateWithHerdrLost = (
  machine: MachineId,
  connection: HerdrConnectionId,
  places: readonly Place[],
  lostAt: DateTime.Utc,
): MachineState =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(0),
    herdrVersion: '',
    herdr: new HerdrLink({ connection, lostAt: Option.some(lostAt) }),
    workspaces: [],
    tabs: [],
    panes: [],
    agents: [],
    places,
  })

export const nextMachineState = (
  previous: MachineState,
  contents: MachineStateContents,
): Option.Option<MachineState> =>
  bumpedIfChanged(
    previous,
    new MachineState({ machine: previous.machine, version: previous.version, ...contents }),
  )

export const withCreatedPanes = (
  previous: MachineState,
  createdPanes: HashSet.HashSet<PaneId>,
): Option.Option<MachineState> =>
  bumpedIfChanged(
    previous,
    new MachineState(
      Struct.evolve(previous, {
        agents: (rows) =>
          rows.map(
            (row) =>
              new AgentRow(
                Struct.evolve(row, { createdByCrook: () => HashSet.has(createdPanes, row.pane) }),
              ),
          ),
      }),
    ),
  )

export const withRunningSubagents = (
  previous: MachineState,
  counts: RunningCounts,
): Option.Option<MachineState> =>
  bumpedIfChanged(
    previous,
    new MachineState(
      Struct.evolve(previous, {
        agents: (rows) =>
          rows.map(
            (row) =>
              new AgentRow(
                Struct.evolve(row, {
                  runningSubagents: () => runningIn(counts, row.claudeSession),
                }),
              ),
          ),
      }),
    ),
  )

export const herdrLostState = (
  previous: MachineState,
  now: DateTime.Utc,
): Option.Option<MachineState> =>
  Option.liftPredicate(previous, Predicate.not(isHerdrLost)).pipe(
    Option.flatMap((state) =>
      bumpedIfChanged(
        state,
        new MachineState(
          Struct.evolve(state, {
            herdr: (link) =>
              new HerdrLink({ connection: link.connection, lostAt: Option.some(now) }),
          }),
        ),
      ),
    ),
  )
