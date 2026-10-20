import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { AgentRow, lastKnownStatus } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { HerdrLink } from '@crook/domain/HerdrLink'
import { MachineId, type PaneId } from '@crook/domain/Ids'
import { Pane } from '@crook/domain/Pane'
import { Tab } from '@crook/domain/Tab'
import { Workspace } from '@crook/domain/Workspace'

export interface StatusChange {
  readonly row: AgentRow
  readonly from: Option.Option<AgentStatus>
}

export const MachineStateVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand('MachineStateVersion'),
)
export type MachineStateVersion = typeof MachineStateVersion.Type

export const PanePresence = Schema.Literals(['agent', 'noAgent', 'gone'])
export type PanePresence = typeof PanePresence.Type

export class MachineState extends Schema.Class<MachineState>('MachineState')({
  machine: MachineId,
  version: MachineStateVersion,
  herdrVersion: Schema.String,
  herdr: HerdrLink,
  workspaces: Schema.Array(Workspace),
  tabs: Schema.Array(Tab),
  panes: Schema.Array(Pane),
  agents: Schema.Array(AgentRow),
}) {}

export const agentsIn = (state: Option.Option<MachineState>): readonly AgentRow[] =>
  Option.match(state, { onNone: () => [], onSome: (found) => found.agents })

export const isResync = (previous: MachineState, next: MachineState): boolean =>
  previous.herdr.connection !== next.herdr.connection

export const isHerdrLost = (state: MachineState): boolean => Option.isSome(state.herdr.lostAt)

export const panePresence = (state: MachineState, pane: PaneId): PanePresence =>
  Option.liftPredicate('agent' as const, () =>
    Arr.some(state.agents, (row) => row.pane === pane),
  ).pipe(
    Option.orElse(() =>
      Option.liftPredicate('noAgent' as const, () =>
        Arr.some(state.panes, (entry) => entry.id === pane),
      ),
    ),
    Option.getOrElse(() => 'gone' as const),
  )

const statusChangeOf =
  (previous: MachineState) =>
  (row: AgentRow): StatusChange => ({
    row,
    from: pipe(
      Arr.findFirst(previous.agents, (before) => before.pane === row.pane),
      Option.map(lastKnownStatus),
    ),
  })

export const statusChanges = (
  previous: MachineState,
  next: MachineState,
): readonly StatusChange[] =>
  isResync(previous, next) || isHerdrLost(next)
    ? []
    : pipe(
        next.agents,
        Arr.map(statusChangeOf(previous)),
        Arr.filter((change) => !Option.contains(change.from, lastKnownStatus(change.row))),
      )
