import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'

import type { MachineId } from '@crook/domain/Ids'
import { herdAtom } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { keepWhileGone, machineDetail, machinesLayout } from '@crook/web/machines/MachineLayout'
import type { MachineScreenModel } from '@crook/web/machines/MachineLayout'
import { HubLink } from '@crook/web/rpc/HubLink'

export const machinesLayoutAtom = Atom.make((get) =>
  Option.map(get(herdAtom), (snapshot) => machinesLayout(snapshot.view)),
)

export const machineScreenAtom = Atom.family((machine: MachineId) =>
  Atom.make((get) =>
    keepWhileGone(
      Option.flatMap(get(herdAtom), (snapshot) => machineDetail(snapshot.view, machine)),
      Option.flatten(get.self<Option.Option<MachineScreenModel>>()),
    ),
  ),
)

export const forgetMachineAtom = Atom.family((machine: MachineId) =>
  hubRuntime.fn(() =>
    Effect.gen(function* () {
      const link = yield* HubLink

      yield* link.forgetMachine(machine)
    }),
  ),
)

export const forgetMachine = (registry: AtomRegistry.AtomRegistry, machine: MachineId) => {
  const forget = forgetMachineAtom(machine)

  registry.set(forget, undefined)

  return AtomRegistry.getResult(registry, forget, { suspendOnWaiting: true })
}
