import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'

import { AgentRow } from '@crook/domain/AgentRow'
import type { Ask } from '@crook/domain/Ask'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdMachine, HerdView } from '@crook/domain/HerdView'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  HerdrConnectionId,
  MachineId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from '@crook/domain/Ids'
import { Machine } from '@crook/domain/Machine'
import type { MachineConnection } from '@crook/domain/Machine'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { Pane } from '@crook/domain/Pane'
import type { Place } from '@crook/domain/Place'
import { Tab } from '@crook/domain/Tab'
import { Workspace } from '@crook/domain/Workspace'

export const START = DateTime.makeUnsafe('2026-10-20T12:00:00Z')
export const LAPTOP = MachineId.make('laptop')
export const DESK = MachineId.make('desk')
export const CROOK_WORKSPACE = WorkspaceId.make('w1')
export const CROOK_TAB = TabId.make('w1:t1')

export const agent = (
  pane: string,
  status: AgentStatus,
  options: {
    readonly title?: string
    readonly label?: string
    readonly secondsAgo?: number
    readonly seq?: number
    readonly branch?: string
    readonly ask?: Ask
    readonly createdByCrook?: boolean
  } = {},
) =>
  new AgentRow({
    pane: PaneId.make(pane),
    workspace: CROOK_WORKSPACE,
    tab: CROOK_TAB,
    terminal: TerminalId.make(`term_${pane}`),
    status,
    title: options.title ?? `Agent in ${pane}`,
    label: Option.fromUndefinedOr(options.label),
    createdByCrook: options.createdByCrook ?? false,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.fromUndefinedOr(options.branch),
    claudeSession: Option.none(),
    stateChangeSeq: options.seq ?? 1,
    statusChangedAt: DateTime.subtractDuration(START, Duration.seconds(options.secondsAgo ?? 0)),
    beforeHandoff: Option.none(),
    ask: Option.fromUndefinedOr(options.ask),
  })

export const machine = (
  id: MachineId,
  agents: readonly AgentRow[],
  options: {
    readonly connection?: MachineConnection
    readonly seen?: readonly string[]
    readonly pinned?: readonly string[]
    readonly label?: string
    readonly agentVersion?: string
    readonly herdrVersion?: string
    readonly places?: readonly Place[]
    readonly shellPanes?: readonly string[]
  } = {},
) =>
  new HerdMachine({
    machine: new Machine({
      id,
      label: options.label ?? id,
      connection: options.connection ?? 'online',
      connectionChangedAt: START,
      lastSeenAt: DateTime.subtractDuration(START, Duration.hours(2)),
      agentVersion: Option.map(Option.fromUndefinedOr(options.agentVersion), (version) =>
        CrookVersion.make(version),
      ),
      herdrVersion: Option.fromUndefinedOr(options.herdrVersion),
    }),
    state: Option.some(
      new MachineState({
        machine: id,
        version: MachineStateVersion.make(1),
        herdrVersion: '0.9.5',
        herdr: new HerdrLink({ connection: HerdrConnectionId.make(1), lostAt: Option.none() }),
        workspaces: [new Workspace({ id: CROOK_WORKSPACE, label: 'crook' })],
        tabs: [new Tab({ id: CROOK_TAB, workspace: CROOK_WORKSPACE, label: 'web' })],
        panes: [
          ...agents.map(
            (row) => new Pane({ id: row.pane, workspace: row.workspace, tab: row.tab }),
          ),
          ...(options.shellPanes ?? []).map(
            (pane) =>
              new Pane({ id: PaneId.make(pane), workspace: CROOK_WORKSPACE, tab: CROOK_TAB }),
          ),
        ],
        agents,
        places: options.places ?? [],
      }),
    ),
    seen: (options.seen ?? []).map((pane) => PaneId.make(pane)),
    pinned: (options.pinned ?? []).map((pane) => PaneId.make(pane)),
  })

export const herd = (machines: readonly HerdMachine[]) =>
  new HerdView({ machines, hubVersion: CrookVersion.make('0.0.1') })
