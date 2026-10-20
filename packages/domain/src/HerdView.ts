import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { PaneId } from '@crook/domain/Ids'
import { Machine } from '@crook/domain/Machine'
import { MachineState } from '@crook/domain/MachineState'

export class HerdMachine extends Schema.Class<HerdMachine>('HerdMachine')({
  machine: Machine,
  state: Schema.OptionFromNullOr(MachineState),
  seen: Schema.Array(PaneId),
  pinned: Schema.Array(PaneId).pipe(Schema.withConstructorDefault(Effect.succeed([]))),
}) {}

export class HerdView extends Schema.Class<HerdView>('HerdView')({
  machines: Schema.Array(HerdMachine),
  hubVersion: CrookVersion,
}) {}
