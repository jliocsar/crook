import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import { needsYouCount } from '@crook/domain/AgentPriority'
import { isBehind } from '@crook/domain/CrookVersion'
import type { CrookVersion } from '@crook/domain/CrookVersion'
import { findMachine } from '@crook/domain/HerdView'
import type { HerdMachine, HerdView } from '@crook/domain/HerdView'
import type { MachineId } from '@crook/domain/Ids'
import type { Machine } from '@crook/domain/Machine'
import { agentsIn } from '@crook/domain/MachineState'
import { bodyFor, SectionBody } from '@crook/web/herd/HerdLayout'
import { needsYouLabel } from '@crook/domain/NeedsYouLabel'
import { shortElapsed } from '@crook/web/time/Elapsed'

export interface MachineCardModel {
  readonly machine: Machine
  readonly agents: number
  readonly needsYou: number
  readonly behindHub: boolean
}

export interface MachinesLayout {
  readonly hubVersion: CrookVersion
  readonly machines: readonly MachineCardModel[]
}

export interface MachineDetailModel {
  readonly card: MachineCardModel
  readonly hubVersion: CrookVersion
  readonly body: SectionBody
}

export interface MachineScreenModel {
  readonly detail: MachineDetailModel
  readonly inHerd: boolean
}

export interface InfoRow {
  readonly label: string
  readonly value: string
  readonly warn: boolean
}

const UNKNOWN_VERSION = 'unknown'

const agentBehindHub = (machine: Machine, hubVersion: CrookVersion): boolean =>
  Option.exists(machine.agentVersion, (version) => isBehind(version, hubVersion))

const machineCard = (herdMachine: HerdMachine, hubVersion: CrookVersion): MachineCardModel => ({
  machine: herdMachine.machine,
  agents: agentsIn(herdMachine.state).length,
  needsYou: needsYouCount(herdMachine),
  behindHub: agentBehindHub(herdMachine.machine, hubVersion),
})

export const machinesLayout = (view: HerdView): MachinesLayout => ({
  hubVersion: view.hubVersion,
  machines: Arr.map(view.machines, (herdMachine) => machineCard(herdMachine, view.hubVersion)),
})

export const machineDetail = (
  view: HerdView,
  machine: MachineId,
): Option.Option<MachineDetailModel> =>
  pipe(
    findMachine(view, machine),
    Option.map((herdMachine) => ({
      card: machineCard(herdMachine, view.hubVersion),
      hubVersion: view.hubVersion,
      body: bodyFor(herdMachine, false),
    })),
  )

export const keepWhileGone = (
  current: Option.Option<MachineDetailModel>,
  previous: Option.Option<MachineScreenModel>,
): Option.Option<MachineScreenModel> =>
  Option.match(current, {
    onSome: (detail) => Option.some({ detail, inHerd: true }),
    onNone: () => Option.map(previous, (last) => ({ detail: last.detail, inHerd: false })),
  })

export const agentsHeading = (body: SectionBody): string =>
  SectionBody.$match(body, {
    Agents: ({ agents }) => `Agents · ${agents.length}`,
    NoAgents: () => 'Agents · 0',
    Offline: () => 'Agents · –',
  })

export const agentCountLabel = (count: number): string =>
  count === 1 ? '1 agent' : `${count} agents`

export const agentSummary = (card: MachineCardModel): string => {
  if (card.agents === 0) {
    return 'No agents'
  }

  return card.needsYou > 0
    ? `${agentCountLabel(card.agents)} · ${needsYouLabel(card.needsYou)}`
    : agentCountLabel(card.agents)
}

export const versionsLine = (machine: Machine): Option.Option<string> =>
  pipe(
    Arr.getSomes([
      Option.map(machine.agentVersion, (version) => `agent ${version}`),
      Option.map(machine.herdrVersion, (version) => `herdr ${version}`),
    ]),
    Option.liftPredicate(Arr.isReadonlyArrayNonEmpty),
    Option.map((parts) => parts.join(' · ')),
  )

export const connectionRow = (machine: Machine, now: DateTime.Utc): InfoRow =>
  Match.value(machine.connection).pipe(
    Match.when('online', () => ({
      label: 'Online for',
      value: shortElapsed(now, machine.connectionChangedAt),
      warn: false,
    })),
    Match.when('reconnecting', () => ({
      label: 'Reconnecting for',
      value: shortElapsed(now, machine.connectionChangedAt),
      warn: false,
    })),
    Match.when('offline', () => ({
      label: 'Last seen',
      value: `${shortElapsed(now, machine.lastSeenAt)} ago`,
      warn: false,
    })),
    Match.exhaustive,
  )

export const agentVersionText = (machine: Machine, hubVersion: CrookVersion): string =>
  Option.match(machine.agentVersion, {
    onNone: () => UNKNOWN_VERSION,
    onSome: (version) =>
      isBehind(version, hubVersion) ? `${version}, hub has ${hubVersion}` : version,
  })

export const herdrVersionText = (machine: Machine): string =>
  Option.getOrElse(machine.herdrVersion, () => UNKNOWN_VERSION)

export const aboutRows = (detail: MachineDetailModel, now: DateTime.Utc): readonly InfoRow[] => [
  connectionRow(detail.card.machine, now),
  {
    label: 'crook agent',
    value: agentVersionText(detail.card.machine, detail.hubVersion),
    warn: detail.card.behindHub,
  },
  { label: 'Herdr', value: herdrVersionText(detail.card.machine), warn: false },
  { label: 'Machine id', value: detail.card.machine.id, warn: false },
]
