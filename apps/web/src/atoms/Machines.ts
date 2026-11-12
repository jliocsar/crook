import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'

import type { MachineId } from '@crook/domain/Ids'
import { herdAtom, orderedHerdAtom } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { keepWhileGone, machineDetail, machinesLayout } from '@crook/web/machines/MachineLayout'
import type { MachineScreenModel } from '@crook/web/machines/MachineLayout'
import { HubLink } from '@crook/web/rpc/HubLink'

export const machinesLayoutAtom = Atom.make((get) =>
  Option.map(get(herdAtom), (snapshot) => machinesLayout(snapshot.view)),
)

export const herdKnownAtom = Atom.make((get) => Option.isSome(get(orderedHerdAtom)))

export const machineScreenAtom = Atom.family((machine: MachineId) =>
  Atom.make((get) =>
    keepWhileGone(
      Option.flatMap(get(orderedHerdAtom), ({ snapshot, hints }) =>
        machineDetail(snapshot.view, machine, hints),
      ),
      Option.flatten(get.self<Option.Option<MachineScreenModel>>()),
    ),
  ).pipe(Atom.withEquality(Equal.equals)),
)

export const forgetMachineAtom = Atom.family((machine: MachineId) =>
  hubRuntime.fn(() => HubLink.use((link) => link.forgetMachine(machine))),
)
