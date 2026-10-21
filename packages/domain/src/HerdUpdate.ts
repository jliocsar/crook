import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as Struct from 'effect/Struct'

import { HerdMachine, HerdView, byMachineId, findMachine } from '@crook/domain/HerdView'
import { MachineId } from '@crook/domain/Ids'

export class HerdReplaced extends Schema.TaggedClass<HerdReplaced>()('HerdReplaced', {
  herd: HerdView,
}) {}

export class MachineReplaced extends Schema.TaggedClass<MachineReplaced>()('MachineReplaced', {
  entry: HerdMachine,
}) {}

export class MachineLeft extends Schema.TaggedClass<MachineLeft>()('MachineLeft', {
  machine: MachineId,
}) {}

export const HerdUpdate = Schema.Union([HerdReplaced, MachineReplaced, MachineLeft])
export type HerdUpdate = typeof HerdUpdate.Type

const isSameEntry = Schema.toEquivalence(HerdMachine)

const isChangedFrom = (herd: HerdView) => (entry: HerdMachine) =>
  !Option.exists(findMachine(herd, entry.machine.id), (before) => isSameEntry(before, entry))

const isGoneFrom = (herd: HerdView) => (entry: HerdMachine) =>
  Option.isNone(findMachine(herd, entry.machine.id))

const machineUpdatesBetween = (previous: HerdView, next: HerdView): readonly HerdUpdate[] =>
  pipe(
    previous.machines,
    Arr.filter(isGoneFrom(next)),
    Arr.map((entry): HerdUpdate => new MachineLeft({ machine: entry.machine.id })),
    Arr.appendAll(
      pipe(
        next.machines,
        Arr.filter(isChangedFrom(previous)),
        Arr.map((entry): HerdUpdate => new MachineReplaced({ entry })),
      ),
    ),
  )

const herdUpdatesBetween = (previous: HerdView, next: HerdView): readonly HerdUpdate[] =>
  previous.hubVersion === next.hubVersion
    ? machineUpdatesBetween(previous, next)
    : [new HerdReplaced({ herd: next })]

const withoutMachine = (herd: HerdView, machine: MachineId) =>
  new HerdView(
    Struct.evolve(herd, {
      machines: (machines) => Arr.filter(machines, (entry) => entry.machine.id !== machine),
    }),
  )

const withEntry = (herd: HerdView, entry: HerdMachine) =>
  new HerdView(
    Struct.evolve(withoutMachine(herd, entry.machine.id), {
      machines: (machines) => pipe(machines, Arr.append(entry), Arr.sort(byMachineId)),
    }),
  )

export const applyHerdUpdate = (
  herd: Option.Option<HerdView>,
  update: HerdUpdate,
): Option.Option<HerdView> =>
  Match.value(update).pipe(
    Match.tagsExhaustive({
      HerdReplaced: (replaced) => Option.some(replaced.herd),
      MachineReplaced: (replaced) =>
        Option.map(herd, (current) => withEntry(current, replaced.entry)),
      MachineLeft: (left) => Option.map(herd, (current) => withoutMachine(current, left.machine)),
    }),
  )

export const herdUpdates = <Failure, Requirements>(
  views: Stream.Stream<HerdView, Failure, Requirements>,
) =>
  Stream.mapAccum(
    views,
    () => Option.none<HerdView>(),
    (previous, next) =>
      [
        Option.some(next),
        Option.match(previous, {
          onNone: (): readonly HerdUpdate[] => [new HerdReplaced({ herd: next })],
          onSome: (before) => herdUpdatesBetween(before, next),
        }),
      ] as const,
  )

export const herdViews = <Failure, Requirements>(
  updates: Stream.Stream<HerdUpdate, Failure, Requirements>,
) =>
  Stream.mapAccum(
    updates,
    () => Option.none<HerdView>(),
    (herd, update) => {
      const next = applyHerdUpdate(herd, update)

      return [next, Option.toArray(next)] as const
    },
  )
