import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import { sumAll } from 'effect/Number'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'

import type { AgentRow } from '@crook/domain/AgentRow'
import type { HerdMachine, HerdView } from '@crook/domain/HerdView'
import type { PaneId } from '@crook/domain/Ids'
import { isOffline } from '@crook/domain/Machine'
import { agentsIn } from '@crook/domain/MachineState'

interface RankedAgent {
  readonly row: AgentRow
  readonly pinned: boolean
  readonly tier: PriorityTier
}

export const PriorityTier = Schema.Literals([
  'blocked',
  'unseenDone',
  'working',
  'settled',
  'unknown',
])
export type PriorityTier = typeof PriorityTier.Type

const NEEDS_YOU_TIERS: readonly PriorityTier[] = ['blocked', 'unseenDone']

const byStatusAge = Order.mapInput(
  DateTime.Order,
  (ranked: RankedAgent) => ranked.row.statusChangedAt,
)

const withinTier = {
  blocked: byStatusAge,
  unseenDone: Order.flip(byStatusAge),
  working: Order.alwaysEqual(),
  settled: Order.alwaysEqual(),
  unknown: Order.alwaysEqual(),
} satisfies Record<PriorityTier, Order.Order<RankedAgent>>

const byTier = Order.mapInput(Order.Number, (ranked: RankedAgent) =>
  PriorityTier.literals.indexOf(ranked.tier),
)

const byPinnedFirst = Order.mapInput(
  Order.flip(Order.Boolean),
  (ranked: RankedAgent) => ranked.pinned,
)

const byPriority: Order.Order<RankedAgent> = Order.combineAll([
  byPinnedFirst,
  byTier,
  (self, that) => withinTier[self.tier](self, that),
])

const paneIn = (panes: readonly PaneId[]) => {
  const listed = HashSet.fromIterable(panes)

  return (row: AgentRow): boolean => HashSet.has(listed, row.pane)
}

export const isSeen = (machine: HerdMachine) => paneIn(machine.seen)

export const isPinned = (machine: HerdMachine) => paneIn(machine.pinned)

export const priorityTier = (machine: HerdMachine) => {
  const seen = isSeen(machine)

  return (row: AgentRow): PriorityTier =>
    Match.value(row.status).pipe(
      Match.when('blocked', (): PriorityTier => 'blocked'),
      Match.when('done', (): PriorityTier => (seen(row) ? 'settled' : 'unseenDone')),
      Match.when('working', (): PriorityTier => 'working'),
      Match.when('idle', (): PriorityTier => 'settled'),
      Match.when('unknown', (): PriorityTier => 'unknown'),
      Match.exhaustive,
    )
}

export const needsYou = (machine: HerdMachine) => {
  const tierOf = priorityTier(machine)

  return (row: AgentRow): boolean => NEEDS_YOU_TIERS.includes(tierOf(row))
}

export const orderAgents = (machine: HerdMachine): AgentRow[] => {
  const tierOf = priorityTier(machine)
  const pinned = isPinned(machine)

  return pipe(
    agentsIn(machine.state),
    Arr.map((row): RankedAgent => ({ row, pinned: pinned(row), tier: tierOf(row) })),
    Arr.sort(byPriority),
    Arr.map((ranked) => ranked.row),
  )
}

export const needsYouCount = (machine: HerdMachine): number =>
  isOffline(machine.machine) ? 0 : Arr.filter(agentsIn(machine.state), needsYou(machine)).length

export const herdNeedsYouCount = (view: HerdView): number =>
  sumAll(Arr.map(view.machines, needsYouCount))
