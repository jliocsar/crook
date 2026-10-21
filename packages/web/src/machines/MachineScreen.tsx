import { useAtomValue } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import type { MachineId } from '@crook/domain/Ids'
import { isOffline } from '@crook/domain/Machine'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { herdAtom } from '@crook/web/atoms/Herd'
import { machineScreenAtom } from '@crook/web/atoms/Machines'
import { Dimmed } from '@crook/web/components/Dimmed'
import { StatusPill } from '@crook/web/components/ui/status-pill'
import type { ConnectionView } from '@crook/web/connection/ConnectionView'
import { SectionBody } from '@crook/web/herd/HerdLayout'
import { AgentCards } from '@crook/web/herd/HerdList'
import type { OpenAgent } from '@crook/web/herd/HerdList'
import { HerdSkeleton } from '@crook/web/herd/HerdSkeleton'
import { useForgetMachine } from '@crook/web/machines/Forget'
import { ForgetMachine } from '@crook/web/machines/ForgetMachine'
import { InfoList, SectionLabel } from '@crook/web/machines/MachineAbout'
import type { AboutRow } from '@crook/web/machines/MachineAbout'
import { MachineStatus } from '@crook/web/machines/MachineHeading'
import {
  agentsHeading,
  agentVersionText,
  connectionRow,
  herdrVersionText,
} from '@crook/web/machines/MachineLayout'
import type { MachineScreenModel } from '@crook/web/machines/MachineLayout'
import { openedFrom } from '@crook/web/navigation/Opener'
import { PushedHeader, PushedScreen, usePushedScreen } from '@crook/web/navigation/PushedScreen'
import { useNow } from '@crook/web/time/Now'

const BACK_LABEL = 'Back to machines'

const aboutRows = (model: MachineScreenModel, now: DateTime.Utc): readonly AboutRow[] => {
  const { card, hubVersion } = model.detail
  const agentVersion = agentVersionText(card.machine, hubVersion)

  return [
    connectionRow(card.machine, now),
    {
      label: 'crook agent',
      value: card.behindHub ? (
        <StatusPill tone="warn" plain className="text-foreground text-sm">
          {agentVersion}
        </StatusPill>
      ) : (
        agentVersion
      ),
    },
    { label: 'Herdr', value: herdrVersionText(card.machine) },
    { label: 'Machine id', value: card.machine.id },
  ]
}

function MachineAgents({
  model,
  now,
  stale,
  onOpenAgent,
}: {
  model: MachineScreenModel
  now: DateTime.Utc
  stale: boolean
  onOpenAgent: OpenAgent
}) {
  const { card, body } = model.detail

  return (
    <section aria-labelledby="machine-agents">
      <SectionLabel id="machine-agents">{agentsHeading(body)}</SectionLabel>
      <Dimmed dimmed={stale || card.machine.connection === 'reconnecting'}>
        {SectionBody.$match(body, {
          Agents: ({ agents }) => (
            <AgentCards
              machine={card.machine.id}
              agents={agents}
              now={now}
              onOpenAgent={onOpenAgent}
            />
          ),
          NoAgents: () => (
            <p className="text-muted-foreground px-4 text-sm">
              No agents running. Start one from Agents.
            </p>
          ),
          Offline: () => (
            <p className="text-muted-foreground px-4 text-sm">
              Offline, so its agents are unknown until it reconnects.
            </p>
          ),
        })}
      </Dimmed>
    </section>
  )
}

function MachineDetail({
  model,
  connection,
  onOpenAgent,
}: {
  model: MachineScreenModel
  connection: ConnectionView
  onOpenAgent: OpenAgent
}) {
  const now = useNow()
  const { back } = usePushedScreen()
  const { failure, forget } = useForgetMachine(back)
  const { card } = model.detail

  return (
    <>
      <PushedHeader
        title={card.machine.label}
        backLabel={BACK_LABEL}
        subtitle={<MachineStatus card={card} now={now} />}
      />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pt-4 pb-[max(2rem,var(--safe-bottom))]">
        <div className="grid gap-6">
          <MachineAgents
            model={model}
            now={now}
            stale={connection.stale}
            onOpenAgent={onOpenAgent}
          />
          <section aria-labelledby="machine-about">
            <SectionLabel id="machine-about">About</SectionLabel>
            <InfoList rows={aboutRows(model, now)} />
          </section>
          {model.inHerd && isOffline(card.machine) ? (
            <ForgetMachine
              label={card.machine.label}
              controlsEnabled={connection.controlsEnabled}
              failure={failure}
              onForget={() => {
                forget(card.machine.id)
              }}
            />
          ) : null}
        </div>
      </div>
    </>
  )
}

function UnknownMachine({ machine, loading }: { machine: MachineId; loading: boolean }) {
  return (
    <>
      <PushedHeader title={machine} backLabel={BACK_LABEL} />
      <div className="pt-4">
        {loading ? (
          <HerdSkeleton label="Loading the machine" />
        ) : (
          <p className="text-muted-foreground px-4 text-sm">
            crook doesn't know this machine. A forgotten machine comes back once its agent connects
            again.
          </p>
        )}
      </div>
    </>
  )
}

export function MachineScreen({ machine }: { machine: MachineId }) {
  const connection = useAtomValue(connectionAtom)
  const herd = useAtomValue(herdAtom)
  const model = useAtomValue(machineScreenAtom(machine))
  const navigate = useNavigate()

  const openAgent: OpenAgent = (agentMachine, card, opener) => {
    void navigate({
      to: '/m/$machine/p/$pane',
      params: { machine: agentMachine, pane: card.row.pane },
      state: openedFrom(opener),
    })
  }

  return (
    <PushedScreen>
      {Option.match(model, {
        onNone: () => <UnknownMachine machine={machine} loading={Option.isNone(herd)} />,
        onSome: (found) => (
          <MachineDetail model={found} connection={connection} onOpenAgent={openAgent} />
        ),
      })}
    </PushedScreen>
  )
}
