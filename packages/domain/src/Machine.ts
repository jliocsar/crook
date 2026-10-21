import * as Schema from 'effect/Schema'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { MachineId } from '@crook/domain/Ids'

export const MachineConnection = Schema.Literals(['online', 'reconnecting', 'offline'])
export type MachineConnection = typeof MachineConnection.Type

export class Machine extends Schema.Class<Machine>('Machine')({
  id: MachineId,
  label: Schema.String,
  connection: MachineConnection,
  connectionChangedAt: Schema.DateTimeUtcFromString,
  lastSeenAt: Schema.DateTimeUtcFromString,
  agentVersion: Schema.OptionFromNullOr(CrookVersion),
  herdrVersion: Schema.OptionFromNullOr(Schema.String),
}) {}

export const isOffline = (machine: Machine): boolean => machine.connection === 'offline'
