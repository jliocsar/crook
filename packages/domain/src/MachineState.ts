import * as Schema from 'effect/Schema'

import { AgentRow } from '@crook/domain/AgentRow'
import { MachineId } from '@crook/domain/Ids'
import { Tab } from '@crook/domain/Tab'
import { Workspace } from '@crook/domain/Workspace'

export const MachineStateVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand('MachineStateVersion'),
)
export type MachineStateVersion = typeof MachineStateVersion.Type

export class MachineState extends Schema.Class<MachineState>('MachineState')({
  machine: MachineId,
  version: MachineStateVersion,
  workspaces: Schema.Array(Workspace),
  tabs: Schema.Array(Tab),
  agents: Schema.Array(AgentRow),
}) {}
