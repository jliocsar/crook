import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { AgentRow } from '@crook/domain/AgentRow'
import { type ClaudeSessionId, type MachineId, PaneId, TabId, WorkspaceId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { Tab } from '@crook/domain/Tab'
import { Workspace } from '@crook/domain/Workspace'
import type { AgentInfo, TabInfo, WorkspaceInfo } from '@crook/herdr/Records'

export interface ResolvedAgent {
  readonly info: AgentInfo
  readonly claudeSession: Option.Option<ClaudeSessionId>
}

export interface HerdReading {
  readonly workspaces: readonly WorkspaceInfo[]
  readonly tabs: readonly TabInfo[]
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

const toAgentRow =
  (since: (info: AgentInfo) => DateTime.Utc) =>
  ({ info, claudeSession }: ResolvedAgent) =>
    new AgentRow({
      pane: PaneId.make(info.pane_id),
      workspace: WorkspaceId.make(info.workspace_id),
      tab: TabId.make(info.tab_id),
      status: info.agent_status,
      title: Option.firstSomeOf([info.terminal_title_stripped, info.title, info.name]).pipe(
        Option.getOrElse(() => ''),
      ),
      cwd: Option.orElse(info.foreground_cwd, () => info.cwd).pipe(Option.getOrElse(() => '')),
      claudeSession,
      stateChangeSeq: info.state_change_seq,
      statusChangedAt: since(info),
    })

const herdContents = (
  previousAgents: readonly AgentRow[],
  reading: HerdReading,
  now: DateTime.Utc,
) => ({
  workspaces: reading.workspaces.map(toWorkspace),
  tabs: reading.tabs.map(toTab),
  agents: reading.agents.map(toAgentRow(statusChangedAt(previousAgents, now))),
})

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
): Option.Option<MachineState> => {
  const contents = herdContents(previous.agents, reading, now)

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
