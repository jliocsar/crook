import * as Schema from 'effect/Schema'

import { MachineId } from '@crook/domain/Ids'

export const MachineConnection = Schema.Literals(['online', 'offline'])
export type MachineConnection = typeof MachineConnection.Type

export class Machine extends Schema.Class<Machine>('Machine')({
  id: MachineId,
  label: Schema.String,
  connection: MachineConnection,
  lastSeenAt: Schema.DateTimeUtcFromString,
}) {}
