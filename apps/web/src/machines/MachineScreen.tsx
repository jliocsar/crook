import { Outlet, useNavigate } from '@tanstack/react-router'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as React from 'react'

import type { MachineId } from '@crook/domain/Ids'
import { isOffline } from '@crook/domain/Machine'
import { useOpenAgentActions } from '@crook/web/actions/AgentActions'
import type { OpenAgentActions } from '@crook/web/actions/AgentActions'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { herdKnownAtom, machineScreenAtom } from '@crook/web/atoms/Machines'
import { Dimmed } from '@crook/web/components/Dimmed'
import { useOpenRow } from '@crook/web/components/swipe/SwipeRow'
import { BannerRoom } from '@crook/web/connection/ConnectionBanner'
import { allowsActions, dimsContent } from '@crook/web/connection/ConnectionView'
import type { ConnectionView } from '@crook/web/connection/ConnectionView'
import { NothingOnThisPhone } from '@crook/web/connection/NothingOnThisPhone'
import { SectionBody } from '@crook/web/herd/HerdLayout'
import { AgentCards } from '@crook/web/herd/HerdList'
import { AGENTS_UNSEEN } from '@crook/web/herd/HerdNotices'
import type { OpenAgent } from '@crook/web/herd/HerdList'
import { HerdSkeleton } from '@crook/web/herd/HerdSkeleton'
import { useForgetMachine } from '@crook/web/machines/Forget'
import { ForgetMachine } from '@crook/web/machines/ForgetMachine'
import { MachineAbout } from '@crook/web/machines/MachineAbout'
import { MachineStatus } from '@crook/web/machines/MachineHeading'
import { agentsHeading } from '@crook/web/machines/MachineLayout'
import type { MachineScreenModel } from '@crook/web/machines/MachineLayout'
import { SectionLabel } from '@crook/web/machines/SectionLabel'
import {
  coverPhaseOf,
  CoveredScope,
  PushedPositionContext,
  StillUnderCover,
  useShownAtomValue,
} from '@crook/web/navigation/Covered'
import type { PushedPosition } from '@crook/web/navigation/Covered'
import { openedFrom } from '@crook/web/navigation/Opener'
import { useCoveredByPushedScreen } from '@crook/web/navigation/Pushed'
import { PushedHeader, PushedScreen, usePushedScreen } from '@crook/web/navigation/PushedScreen'

interface MachineBodyProps {
  readonly machine: MachineId
  readonly onOpenAgent: OpenAgent
  readonly onOpenActions: OpenAgentActions
}

type UnknownBody = 'loading' | 'away' | 'unknown'

const BACK_LABEL = 'Back to machines'

const unknownBodyOf = (herdKnown: boolean, connection: ConnectionView): UnknownBody => {
  if (herdKnown) {
    return 'unknown'
  }

  return dimsContent(connection) ? 'away' : 'loading'
}

const MachineContent = React.memo(function MachineContent({
  machine,
  model,
  connection,
  herdKnown,
  onOpenAgent,
  onOpenActions,
}: MachineBodyProps & {
  readonly model: Option.Option<MachineScreenModel>
  readonly connection: ConnectionView
  readonly herdKnown: boolean
}) {
  return (
    <StillUnderCover>
      {Option.match(model, {
        onNone: () => (
          <UnknownMachine title={machine} body={unknownBodyOf(herdKnown, connection)} />
        ),
        onSome: (found) => (
          <MachineDetail
            model={found}
            connection={connection}
            onOpenAgent={onOpenAgent}
            onOpenActions={onOpenActions}
          />
        ),
      })}
    </StillUnderCover>
  )
})

function MachineAgents({
  model,
  stale,
  controlsEnabled,
  onOpenAgent,
  onOpenActions,
}: {
  model: MachineScreenModel
  stale: boolean
  controlsEnabled: boolean
  onOpenAgent: OpenAgent
  onOpenActions: OpenAgentActions
}) {
  const { card, body } = model.detail
  const row = useOpenRow()

  return (
    <section aria-labelledby="machine-agents">
      <SectionLabel id="machine-agents">{agentsHeading(body)}</SectionLabel>
      <Dimmed dimmed={stale || card.machine.connection === 'reconnecting'}>
        {SectionBody.$match(body, {
          Agents: ({ agents }) => (
            <AgentCards
              machine={card.machine.id}
              agents={agents}
              row={row}
              controlsEnabled={controlsEnabled}
              onOpenAgent={onOpenAgent}
              onOpenActions={onOpenActions}
            />
          ),
          NoAgents: () => (
            <p className="text-muted-foreground px-4 text-sm">
              No agents running. Start one from Agents.
            </p>
          ),
          AgentsUnseen: () => <p className="text-muted-foreground px-4 text-sm">{AGENTS_UNSEEN}</p>,
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

function UnknownMachine({ title, body }: { title: string; body: UnknownBody }) {
  return (
    <>
      <PushedHeader title={title} backLabel={BACK_LABEL} />
      <div className="pt-4">
        {Match.value(body).pipe(
          Match.when('loading', () => <HerdSkeleton label="Loading the machine" />),
          Match.when('away', () => (
            <NothingOnThisPhone
              title="Nothing about this machine on this phone yet"
              description="It shows once crook reconnects."
            />
          )),
          Match.when('unknown', () => (
            <p className="text-muted-foreground px-4 text-sm">
              crook doesn't know this machine. A forgotten machine comes back once its agent
              connects again.
            </p>
          )),
          Match.exhaustive,
        )}
      </div>
    </>
  )
}

function MachineDetail({
  model,
  connection,
  onOpenAgent,
  onOpenActions,
}: {
  model: MachineScreenModel
  connection: ConnectionView
  onOpenAgent: OpenAgent
  onOpenActions: OpenAgentActions
}) {
  const { back } = usePushedScreen()
  const { card } = model.detail
  const forgetting = useForgetMachine(card.machine.id, {
    connection: card.machine.connection,
    controlsEnabled: allowsActions(connection),
  })

  React.useEffect(() => {
    if (forgetting.forgotten) {
      back()
    }
  }, [forgetting.forgotten])

  if (!model.inHerd && !forgetting.pending && !forgetting.forgotten) {
    return <UnknownMachine title={card.machine.label} body="unknown" />
  }

  return (
    <>
      <PushedHeader
        title={card.machine.label}
        backLabel={BACK_LABEL}
        subtitle={
          <span className="flex min-w-0 items-center gap-2">
            <MachineStatus card={card} />
          </span>
        }
      />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pt-4 pb-[max(2rem,var(--safe-bottom))]">
        <BannerRoom>
          <div className="grid gap-6">
            <MachineAgents
              model={model}
              stale={dimsContent(connection)}
              controlsEnabled={allowsActions(connection)}
              onOpenAgent={onOpenAgent}
              onOpenActions={onOpenActions}
            />
            <MachineAbout detail={model.detail} />
            {model.inHerd && isOffline(card.machine) ? (
              <ForgetMachine
                label={card.machine.label}
                disabled={!allowsActions(connection) || forgetting.pending}
                pending={forgetting.pending}
                failure={forgetting.failure}
                onForget={forgetting.forget}
              />
            ) : null}
          </div>
        </BannerRoom>
      </div>
    </>
  )
}

function MachineBody(props: MachineBodyProps) {
  const connection = useShownAtomValue(connectionAtom)
  const herdKnown = useShownAtomValue(herdKnownAtom)
  const model = useShownAtomValue(machineScreenAtom(props.machine))

  return <MachineContent model={model} connection={connection} herdKnown={herdKnown} {...props} />
}

export function MachineScreen({ machine }: { machine: MachineId }) {
  const navigate = useNavigate()
  const openActions = useOpenAgentActions()
  const covered = useCoveredByPushedScreen()
  const [position, setPosition] = React.useState<PushedPosition>('arriving')

  const openAgent: OpenAgent = (agentMachine, card, opener) => {
    void navigate({
      to: '/machines/$machine/p/$pane',
      params: { machine: agentMachine, pane: card.row.pane },
      state: openedFrom(opener),
    })
  }

  return (
    <>
      <PushedScreen>
        <CoveredScope phase={coverPhaseOf(covered, position)}>
          <MachineBody machine={machine} onOpenAgent={openAgent} onOpenActions={openActions} />
        </CoveredScope>
      </PushedScreen>
      <PushedPositionContext value={setPosition}>
        <Outlet />
      </PushedPositionContext>
    </>
  )
}
