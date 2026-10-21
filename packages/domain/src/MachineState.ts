import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { AgentRow } from '@crook/domain/AgentRow'
import { HerdrLink } from '@crook/domain/HerdrLink'
import { MachineId, type PaneId } from '@crook/domain/Ids'
import { Pane } from '@crook/domain/Pane'
import { Place } from '@crook/domain/Place'
import { Tab } from '@crook/domain/Tab'
import { Workspace } from '@crook/domain/Workspace'

export type PanePresence = 'agent' | 'noAgent' | 'gone'

export const MachineStateVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand('MachineStateVersion'),
)
export type MachineStateVersion = typeof MachineStateVersion.Type

export class MachineState extends Schema.Class<MachineState>('MachineState')({
  machine: MachineId,
  version: MachineStateVersion,
  herdrVersion: Schema.String,
  herdr: HerdrLink,
  workspaces: Schema.Array(Workspace),
  tabs: Schema.Array(Tab),
  panes: Schema.Array(Pane),
  agents: Schema.Array(AgentRow),
  places: Schema.Array(Place),
}) {}

export const agentsIn = (state: Option.Option<MachineState>): readonly AgentRow[] =>
  Option.match(state, { onNone: () => [], onSome: (found) => found.agents })

export const isResync = (previous: MachineState, next: MachineState): boolean =>
  previous.herdr.connection !== next.herdr.connection

export const isHerdrLost = (state: MachineState): boolean => Option.isSome(state.herdr.lostAt)

export const panePresence = (state: MachineState, pane: PaneId): PanePresence => {
  if (Arr.some(state.agents, (row) => row.pane === pane)) {
    return 'agent'
  }

  return Arr.some(state.panes, (entry) => entry.id === pane) ? 'noAgent' : 'gone'
}
