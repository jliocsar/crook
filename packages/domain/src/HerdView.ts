import * as Schema from 'effect/Schema'

import { Machine } from '@crook/domain/Machine'
import { MachineState } from '@crook/domain/MachineState'

export class HerdMachine extends Schema.Class<HerdMachine>('HerdMachine')({
  machine: Machine,
  state: Schema.OptionFromNullOr(MachineState),
}) {}

export class HerdView extends Schema.Class<HerdView>('HerdView')({
  machines: Schema.Array(HerdMachine),
}) {}
