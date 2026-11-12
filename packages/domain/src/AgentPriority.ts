import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import { sumAll } from 'effect/Number'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Record from 'effect/Record'
import * as Schema from 'effect/Schema'

import type { AgentRow } from '@crook/domain/AgentRow'
import type { HerdMachine, HerdView } from '@crook/domain/HerdView'
import { type GlobalPaneId, type PaneId, toGlobalPaneId } from '@crook/domain/Ids'
import { isOffline } from '@crook/domain/Machine'
import { agentsIn } from '@crook/domain/MachineState'
import type { OpenedTimes } from '@crook/domain/OpenedTimes'

interface RankedAgent {
  readonly row: AgentRow
  readonly pinned: boolean
  readonly drafted: boolean
  readonly tier: PriorityTier
  readonly openedAt: Option.Option<DateTime.Utc>
}

export interface OrderHints {
  readonly drafted: HashSet.HashSet<GlobalPaneId>
  readonly openedAt: OpenedTimes
}

const PriorityTier = Schema.Literals(['blocked', 'unseenDone', 'working', 'settled', 'unknown'])
type PriorityTier = typeof PriorityTier.Type

const PriorityRank = Schema.Literals(['blocked', 'unseenDone', 'rest'])
type PriorityRank = typeof PriorityRank.Type

const NEEDS_YOU_TIERS: readonly PriorityTier[] = ['blocked', 'unseenDone']

export const noOrderHints: OrderHints = { drafted: HashSet.empty(), openedAt: {} }

const rankOfTier = {
  blocked: 'blocked',
  unseenDone: 'unseenDone',
  working: 'rest',
  settled: 'rest',
  unknown: 'rest',
} satisfies Record.ReadonlyRecord<PriorityTier, PriorityRank>

const byStatusAge = Order.mapInput(
  DateTime.Order,
  (ranked: RankedAgent) => ranked.row.statusChangedAt,
)

const byLastOpened = Order.mapInput(Order.flip(Order.Number), (ranked: RankedAgent) =>
  Option.match(ranked.openedAt, {
    onNone: () => Number.NEGATIVE_INFINITY,
    onSome: DateTime.toEpochMillis,
  }),
)

const withinRank = {
  blocked: byStatusAge,
  unseenDone: Order.flip(byStatusAge),
  rest: byLastOpened,
} satisfies Record.ReadonlyRecord<PriorityRank, Order.Order<RankedAgent>>

const rankOf = (ranked: RankedAgent): PriorityRank => rankOfTier[ranked.tier]

const byRank = Order.mapInput(Order.Number, (ranked: RankedAgent) =>
  PriorityRank.literals.indexOf(rankOf(ranked)),
)

const firstWhen = (flag: (ranked: RankedAgent) => boolean) =>
  Order.mapInput(Order.flip(Order.Boolean), flag)

const byPriority: Order.Order<RankedAgent> = Order.combineAll([
  firstWhen((ranked) => ranked.pinned),
  firstWhen((ranked) => ranked.drafted),
  byRank,
  (self, that) => withinRank[rankOf(self)](self, that),
])

const paneIn = (panes: readonly PaneId[]) => {
  const listed = HashSet.fromIterable(panes)

  return (row: AgentRow): boolean => HashSet.has(listed, row.pane)
}

export const isSeen = (machine: HerdMachine) => paneIn(machine.seen)

export const isPinned = (machine: HerdMachine) => paneIn(machine.pinned)

const priorityTier = (machine: HerdMachine) => {
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

const isDrafted = (machine: HerdMachine, hints: OrderHints) => (row: AgentRow) =>
  HashSet.has(hints.drafted, toGlobalPaneId(machine.machine.id, row.pane))

const openedAtOf = (machine: HerdMachine, hints: OrderHints) => (row: AgentRow) =>
  pipe(
    Record.get(hints.openedAt, machine.machine.id),
    Option.flatMap((panes) => Record.get(panes, row.pane)),
  )

export const orderAgents = (machine: HerdMachine, hints: OrderHints): AgentRow[] => {
  const tierOf = priorityTier(machine)
  const pinned = isPinned(machine)
  const drafted = isDrafted(machine, hints)
  const openedAt = openedAtOf(machine, hints)

  return pipe(
    agentsIn(machine.state),
    Arr.map((row): RankedAgent => ({
      row,
      pinned: pinned(row),
      drafted: drafted(row),
      tier: tierOf(row),
      openedAt: openedAt(row),
    })),
    Arr.sort(byPriority),
    Arr.map((ranked) => ranked.row),
  )
}

export const needsYouCount = (machine: HerdMachine): number =>
  isOffline(machine.machine) ? 0 : Arr.filter(agentsIn(machine.state), needsYou(machine)).length

export const herdNeedsYouCount = (view: HerdView): number =>
  sumAll(Arr.map(view.machines, needsYouCount))
