import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { type MachineId, PaneId } from '@crook/domain/Ids'
import { Machine } from '@crook/domain/Machine'
import { MachineState } from '@crook/domain/MachineState'
import { type Place, byMostRecentUse } from '@crook/domain/Place'

export interface MachinePlace {
  readonly machine: MachineId
  readonly place: Place
}

export class HerdMachine extends Schema.Class<HerdMachine>('HerdMachine')({
  machine: Machine,
  state: Schema.OptionFromNullOr(MachineState),
  seen: Schema.Array(PaneId),
  pinned: Schema.Array(PaneId),
}) {}

export class HerdView extends Schema.Class<HerdView>('HerdView')({
  machines: Schema.Array(HerdMachine),
  hubVersion: CrookVersion,
}) {}

const placeByMostRecentUse = Order.mapInput(byMostRecentUse, (entry: MachinePlace) => entry.place)

export const isOnline = (entry: HerdMachine): boolean => entry.machine.connection === 'online'

export const findMachine = (view: HerdView, machine: MachineId): Option.Option<HerdMachine> =>
  Arr.findFirst(view.machines, (entry) => entry.machine.id === machine)

export const placesOf = (entry: HerdMachine): readonly MachinePlace[] =>
  Option.match(entry.state, {
    onNone: () => [],
    onSome: (state) => state.places.map((place) => ({ machine: entry.machine.id, place })),
  })

export const mostRecentPlace = (herd: HerdView): Option.Option<MachinePlace> =>
  pipe(
    herd.machines,
    Arr.filter(isOnline),
    Arr.flatMap(placesOf),
    Arr.sort(placeByMostRecentUse),
    Arr.head,
  )
