import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

import { isPinned, needsYou, needsYouCount, orderAgents } from '@crook/domain/AgentPriority'
import type { OrderHints } from '@crook/domain/AgentPriority'
import { type AgentRow, pendingAskSummary } from '@crook/domain/AgentRow'
import { findMachine, isOnline } from '@crook/domain/HerdView'
import type { HerdMachine, HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { isOffline } from '@crook/domain/Machine'
import type { Machine } from '@crook/domain/Machine'
import { agentsIn } from '@crook/domain/MachineState'

export interface AgentCardModel {
  readonly row: AgentRow
  readonly needsYou: boolean
  readonly pinned: boolean
  readonly workspace: string
  readonly tab: string
  readonly askSummary: Option.Option<string>
  readonly herdrLostAt: Option.Option<DateTime.Utc>
}

export type SectionBody = Data.TaggedEnum<{
  Agents: { readonly agents: readonly AgentCardModel[] }
  NoAgents: Record<never, never>
  AgentsUnseen: Record<never, never>
  Offline: Record<never, never>
}>

export interface MachineSectionModel {
  readonly machine: Machine
  readonly needsYou: number
  readonly herdrLostAt: Option.Option<DateTime.Utc>
  readonly body: SectionBody
}

export type HerdNotice = 'noMachines' | 'nothingRunning' | 'allOffline'

export interface HerdLayout {
  readonly notice: Option.Option<HerdNotice>
  readonly sections: readonly MachineSectionModel[]
}

export const SectionBody = Data.taggedEnum<SectionBody>()

const labelOf = <Id extends string>(
  entries: readonly { readonly id: Id; readonly label: string }[],
  id: Id,
): string =>
  pipe(
    Arr.findFirst(entries, (entry) => entry.id === id),
    Option.map((entry) => entry.label),
    Option.getOrElse(() => id),
  )

export const herdrLostAtOf = ({ machine, state }: HerdMachine): Option.Option<DateTime.Utc> =>
  isOffline(machine) ? Option.none() : Option.flatMap(state, (shown) => shown.herdr.lostAt)

export const cardFor = (herdMachine: HerdMachine) => {
  const loud = needsYou(herdMachine)
  const herdrLostAt = herdrLostAtOf(herdMachine)
  const pinned = isPinned(herdMachine)
  const workspaces = Option.match(herdMachine.state, {
    onNone: () => [],
    onSome: (state) => state.workspaces,
  })
  const tabs = Option.match(herdMachine.state, { onNone: () => [], onSome: (state) => state.tabs })

  return (row: AgentRow): AgentCardModel => ({
    row,
    needsYou: loud(row),
    pinned: pinned(row),
    workspace: labelOf(workspaces, row.workspace),
    tab: labelOf(tabs, row.tab),
    askSummary: pendingAskSummary(row),
    herdrLostAt,
  })
}

const agentCards = (herdMachine: HerdMachine, hints: OrderHints): AgentCardModel[] =>
  Arr.map(orderAgents(herdMachine, hints), cardFor(herdMachine))

const hasNoAgents = (herdMachine: HerdMachine) => agentsIn(herdMachine.state).length === 0

export const agentsUnseen = (herdMachine: HerdMachine): boolean =>
  hasNoAgents(herdMachine) && Option.isSome(herdrLostAtOf(herdMachine))

const noticeFor = (view: HerdView): Option.Option<HerdNotice> => {
  if (Arr.isReadonlyArrayEmpty(view.machines)) {
    return Option.some('noMachines')
  }

  if (Arr.every(view.machines, (herdMachine) => isOffline(herdMachine.machine))) {
    return Option.some('allOffline')
  }

  return Arr.every(
    view.machines,
    (herdMachine) => hasNoAgents(herdMachine) && !agentsUnseen(herdMachine),
  )
    ? Option.some('nothingRunning')
    : Option.none()
}

export const bodyFor = (
  herdMachine: HerdMachine,
  nothingRunning: boolean,
  hints: OrderHints,
): SectionBody => {
  if (isOffline(herdMachine.machine)) {
    return SectionBody.Offline()
  }

  if (agentsUnseen(herdMachine)) {
    return SectionBody.AgentsUnseen()
  }

  if (hasNoAgents(herdMachine) && !nothingRunning) {
    return SectionBody.NoAgents()
  }

  return SectionBody.Agents({ agents: agentCards(herdMachine, hints) })
}

export const herdLayout = (view: HerdView, hints: OrderHints): HerdLayout => {
  const notice = noticeFor(view)
  const nothingRunning = Option.contains(notice, 'nothingRunning')

  return {
    notice,
    sections: Arr.map(view.machines, (herdMachine) => ({
      machine: herdMachine.machine,
      needsYou: needsYouCount(herdMachine),
      herdrLostAt: herdrLostAtOf(herdMachine),
      body: bodyFor(herdMachine, nothingRunning, hints),
    })),
  }
}

export const isOnlineMachine = (view: HerdView, machine: MachineId): boolean =>
  Option.exists(findMachine(view, machine), isOnline)

export const findAgent = (
  view: HerdView,
  machine: MachineId,
  pane: PaneId,
): Option.Option<{ readonly herdMachine: HerdMachine; readonly row: AgentRow }> =>
  pipe(
    findMachine(view, machine),
    Option.flatMap((herdMachine) =>
      pipe(
        Arr.findFirst(agentsIn(herdMachine.state), (row) => row.pane === pane),
        Option.map((row) => ({ herdMachine, row })),
      ),
    ),
  )
