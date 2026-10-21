import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'
import * as Struct from 'effect/Struct'

import { AgentRow } from '@crook/domain/AgentRow'
import { type ClaudeSessionId, type MachineId, PaneId, TabId, WorkspaceId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
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
}

interface MachineStateContents {
  readonly herdrVersion: string
  readonly workspaces: readonly Workspace[]
  readonly tabs: readonly Tab[]
  readonly agents: readonly AgentRow[]
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

const statusChangedAt =
  (previousAgents: readonly AgentRow[], now: DateTime.Utc) => (info: AgentInfo) =>
    Arr.findFirst(
      previousAgents,
      (row) => row.pane === info.pane_id && row.status === info.agent_status,
    ).pipe(
      Option.match({
        onNone: () => now,
        onSome: (row) => row.statusChangedAt,
      }),
    )

export const workingDirectoryOf = (info: AgentInfo): Option.Option<string> =>
  Option.orElse(info.foreground_cwd, () => info.cwd)

export const paneLabel = (pane: PaneInfo): Option.Option<string> =>
  pane.label.pipe(Option.map(Str.trim), Option.filter(Str.isNonEmpty))

const labelIn = (panes: readonly PaneInfo[]) => (info: AgentInfo) =>
  Arr.findFirst(panes, (pane) => pane.pane_id === info.pane_id).pipe(Option.flatMap(paneLabel))

const toAgentRow =
  (
    since: (info: AgentInfo) => DateTime.Utc,
    labelOf: (info: AgentInfo) => Option.Option<string>,
    createdPanes: HashSet.HashSet<PaneId>,
  ) =>
  ({ info, claudeSession, branch }: ResolvedAgent) =>
    new AgentRow({
      pane: PaneId.make(info.pane_id),
      workspace: WorkspaceId.make(info.workspace_id),
      tab: TabId.make(info.tab_id),
      status: info.agent_status,
      title: Option.firstSomeOf([info.terminal_title_stripped, info.title, info.name]).pipe(
        Option.getOrElse(() => ''),
      ),
      label: labelOf(info),
      createdByCrook: HashSet.has(createdPanes, PaneId.make(info.pane_id)),
      cwd: Option.getOrElse(workingDirectoryOf(info), () => ''),
      branch,
      claudeSession,
      stateChangeSeq: info.state_change_seq,
      statusChangedAt: since(info),
    })

const herdContents = (
  previousAgents: readonly AgentRow[],
  reading: HerdReading,
  now: DateTime.Utc,
): MachineStateContents => ({
  herdrVersion: reading.herdrVersion,
  workspaces: reading.workspaces.map(toWorkspace),
  tabs: reading.tabs.map(toTab),
  agents: reading.agents.map(
    toAgentRow(statusChangedAt(previousAgents, now), labelIn(reading.panes), reading.createdPanes),
  ),
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
  reading: HerdReading,
  now: DateTime.Utc,
): MachineState =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(0),
    ...herdContents([], reading, now),
  })

export const nextMachineState = (
  previous: MachineState,
  reading: HerdReading,
  now: DateTime.Utc,
): Option.Option<MachineState> =>
  withChangedContents(previous, herdContents(previous.agents, reading, now))

export const withCreatedPanes = (
  previous: MachineState,
  createdPanes: HashSet.HashSet<PaneId>,
): Option.Option<MachineState> =>
  withChangedContents(previous, {
    herdrVersion: previous.herdrVersion,
    workspaces: previous.workspaces,
    tabs: previous.tabs,
    agents: previous.agents.map(
      (row) =>
        new AgentRow(
          Struct.evolve(row, { createdByCrook: () => HashSet.has(createdPanes, row.pane) }),
        ),
    ),
  })
