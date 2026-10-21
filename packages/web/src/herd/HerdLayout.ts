import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Str from 'effect/String'

import { needsYou, needsYouCount, orderAgents } from '@crook/domain/AgentPriority'
import { type AgentRow, agentTitle } from '@crook/domain/AgentRow'
import type { HerdMachine, HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { isOffline } from '@crook/domain/Machine'
import type { Machine } from '@crook/domain/Machine'
import { agentsIn } from '@crook/domain/MachineState'

export interface AgentCardModel {
  readonly row: AgentRow
  readonly needsYou: boolean
  readonly workspace: string
  readonly tab: string
}

export type SectionBody = Data.TaggedEnum<{
  Agents: { readonly agents: readonly AgentCardModel[] }
  NoAgents: Record<never, never>
  Offline: Record<never, never>
}>

export interface MachineSectionModel {
  readonly machine: Machine
  readonly needsYou: number
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

const agentCards = (herdMachine: HerdMachine): AgentCardModel[] => {
  const loud = needsYou(herdMachine)
  const workspaces = Option.match(herdMachine.state, {
    onNone: () => [],
    onSome: (state) => state.workspaces,
  })
  const tabs = Option.match(herdMachine.state, { onNone: () => [], onSome: (state) => state.tabs })

  return Arr.map(orderAgents(herdMachine), (row) => ({
    row,
    needsYou: loud(row),
    workspace: labelOf(workspaces, row.workspace),
    tab: labelOf(tabs, row.tab),
  }))
}

const hasNoAgents = (herdMachine: HerdMachine) => agentsIn(herdMachine.state).length === 0

const noticeFor = (view: HerdView): Option.Option<HerdNotice> => {
  if (Arr.isReadonlyArrayEmpty(view.machines)) {
    return Option.some('noMachines')
  }

  if (Arr.every(view.machines, (herdMachine) => isOffline(herdMachine.machine))) {
    return Option.some('allOffline')
  }

  return Arr.every(view.machines, hasNoAgents) ? Option.some('nothingRunning') : Option.none()
}

const bodyFor = (herdMachine: HerdMachine, nothingRunning: boolean): SectionBody => {
  if (isOffline(herdMachine.machine)) {
    return SectionBody.Offline()
  }

  if (hasNoAgents(herdMachine) && !nothingRunning) {
    return SectionBody.NoAgents()
  }

  return SectionBody.Agents({ agents: agentCards(herdMachine) })
}

export const herdLayout = (view: HerdView): HerdLayout => {
  const notice = noticeFor(view)
  const nothingRunning = Option.contains(notice, 'nothingRunning')

  return {
    notice,
    sections: Arr.map(view.machines, (herdMachine) => ({
      machine: herdMachine.machine,
      needsYou: needsYouCount(herdMachine),
      body: bodyFor(herdMachine, nothingRunning),
    })),
  }
}

export const agentTitleOrPane = (row: AgentRow): string =>
  pipe(
    agentTitle(row),
    Option.liftPredicate(Str.isNonEmpty),
    Option.getOrElse(() => row.pane),
  )

export const findAgent = (
  view: HerdView,
  machine: MachineId,
  pane: PaneId,
): Option.Option<{ readonly herdMachine: HerdMachine; readonly row: AgentRow }> =>
  pipe(
    Arr.findFirst(view.machines, (herdMachine) => herdMachine.machine.id === machine),
    Option.flatMap((herdMachine) =>
      pipe(
        Arr.findFirst(agentsIn(herdMachine.state), (row) => row.pane === pane),
        Option.map((row) => ({ herdMachine, row })),
      ),
    ),
  )
