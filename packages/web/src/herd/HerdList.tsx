import { cn } from 'cn'
import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import { Pin, PinOff, X } from 'lucide-react'
import { AnimatePresence, motion, PresenceContext } from 'motion/react'
import * as React from 'react'

import { toGlobalPaneId } from '@crook/domain/Ids'
import type { MachineId } from '@crook/domain/Ids'
import type { OpenAgentActions } from '@crook/web/actions/AgentActions'
import { usePinAgent } from '@crook/web/actions/PinAgent'
import { PaneAddress } from '@crook/web/atoms/AgentActions'
import { SwipeRow, useOpenRow } from '@crook/web/components/swipe/SwipeRow'
import type { OpenRow, SwipeAction } from '@crook/web/components/swipe/SwipeRow'
import { ASKING_BORDER, AgentCard } from '@crook/web/herd/AgentCard'
import { useHeldOrder } from '@crook/web/herd/HeldOrder'
import { SectionBody } from '@crook/web/herd/HerdLayout'
import type { AgentCardModel, HerdLayout, HerdNotice } from '@crook/web/herd/HerdLayout'
import { AllOffline, NoAgentsLine, NothingRunning, OfflineLine } from '@crook/web/herd/HerdNotices'
import { MachineSection } from '@crook/web/herd/MachineSection'
import { NoMachines } from '@crook/web/machines/NoMachines'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { SPRING } from '@crook/web/motion/Springs'
import { useFailureToast } from '@crook/web/toast/FailureToast'

export type OpenAgent = (machine: MachineId, card: AgentCardModel, opener: HTMLElement) => void

interface AgentCardRowProps {
  readonly machine: MachineId
  readonly card: AgentCardModel
  readonly row: OpenRow
  readonly controlsEnabled: boolean
  readonly onOpenAgent: OpenAgent
  readonly onOpenActions: OpenAgentActions
}

interface HerdNoticeActions {
  readonly controlsEnabled: boolean
  readonly onNewAgent: (opener: HTMLElement) => void
  readonly onAddMachine: () => void
}

const HERD_NOTICE = {
  noMachines: ({ onAddMachine }) => <NoMachines onAddMachine={onAddMachine} />,
  allOffline: () => <AllOffline />,
  nothingRunning: ({ controlsEnabled, onNewAgent }) => (
    <NothingRunning controlsEnabled={controlsEnabled} onNewAgent={onNewAgent} />
  ),
} satisfies Record<HerdNotice, (actions: HerdNoticeActions) => React.ReactNode>

const pinAction = (pinned: boolean, run: () => void, disabled: boolean): SwipeAction => ({
  label: pinned ? 'Unpin' : 'Pin',
  icon: pinned ? (
    <PinOff aria-hidden="true" className="size-4" />
  ) : (
    <Pin aria-hidden="true" className="size-4" />
  ),
  tone: 'secondary',
  run,
  disabled,
})

const closeAction = (run: () => void, disabled: boolean): SwipeAction => ({
  label: 'Close',
  icon: <X aria-hidden="true" className="size-4" />,
  tone: 'destructive',
  run,
  disabled,
})

const AgentCardBody = React.memo(function AgentCardBody({
  machine,
  card,
  row,
  controlsEnabled,
  onOpenAgent,
  onOpenActions,
}: AgentCardRowProps) {
  const { pane } = card.row
  const pin = usePinAgent(new PaneAddress({ machine, pane }), {
    pinned: card.pinned,
    controlsEnabled,
  })

  const openActions = () => {
    onOpenActions(machine, pane, 'card')
  }

  useFailureToast(pin.failure)

  return (
    <SwipeRow
      id={toGlobalPaneId(machine, pane)}
      row={row}
      surface="agent"
      frameClassName={cn(
        'transition-[border-color] duration-(--motion) ease-(--ease-out)',
        Option.isSome(card.askSummary) && ASKING_BORDER,
      )}
      actions={[
        pinAction(card.pinned, pin.toggle, !controlsEnabled || pin.pending),
        closeAction(openActions, !controlsEnabled),
      ]}
      onTap={(opener) => {
        onOpenAgent(machine, card, opener)
      }}
      onLongPress={openActions}
    >
      <AgentCard card={card} />
    </SwipeRow>
  )
}, Equal.equals)

function AgentCardRow(props: AgentCardRowProps) {
  return (
    <motion.li
      layout="position"
      transition={SPRING}
      exit={motionTokens().exit}
      className="grid grid-cols-1 gap-2"
    >
      <PresenceContext value={null}>
        <AgentCardBody {...props} />
      </PresenceContext>
    </motion.li>
  )
}

export function AgentCards({
  machine,
  agents,
  row,
  controlsEnabled,
  onOpenAgent,
  onOpenActions,
}: {
  machine: MachineId
  agents: readonly AgentCardModel[]
  row: OpenRow
  controlsEnabled: boolean
  onOpenAgent: OpenAgent
  onOpenActions: OpenAgentActions
}) {
  const ordered = useHeldOrder(agents, row.holding)

  return (
    <ul className="grid grid-cols-1 gap-2 px-3">
      <AnimatePresence initial={false}>
        {ordered.map((card) => (
          <AgentCardRow
            key={card.row.pane}
            machine={machine}
            card={card}
            row={row}
            controlsEnabled={controlsEnabled}
            onOpenAgent={onOpenAgent}
            onOpenActions={onOpenActions}
          />
        ))}
      </AnimatePresence>
    </ul>
  )
}

export function HerdList({
  layout,
  controlsEnabled,
  isOpen,
  onToggle,
  onOpenAgent,
  onOpenActions,
  onNewAgent,
  onAddMachine,
}: {
  layout: HerdLayout
  controlsEnabled: boolean
  isOpen: (machine: MachineId) => boolean
  onToggle: (machine: MachineId) => void
  onOpenAgent: OpenAgent
  onOpenActions: OpenAgentActions
  onNewAgent: (opener: HTMLElement) => void
  onAddMachine: () => void
}) {
  const row = useOpenRow()

  return (
    <div data-slot="herd-list" className="grid grid-cols-1 gap-3 pt-2">
      {Option.match(layout.notice, {
        onNone: () => null,
        onSome: (notice) => HERD_NOTICE[notice]({ controlsEnabled, onNewAgent, onAddMachine }),
      })}
      {layout.sections.map((section) => (
        <MachineSection
          key={section.machine.id}
          section={section}
          open={isOpen(section.machine.id)}
          onToggle={() => {
            onToggle(section.machine.id)
          }}
        >
          {SectionBody.$match(section.body, {
            Agents: ({ agents }) => (
              <AgentCards
                machine={section.machine.id}
                agents={agents}
                row={row}
                controlsEnabled={controlsEnabled}
                onOpenAgent={onOpenAgent}
                onOpenActions={onOpenActions}
              />
            ),
            NoAgents: () => <NoAgentsLine />,
            Offline: () => <OfflineLine lastSeenAt={section.machine.lastSeenAt} />,
          })}
        </MachineSection>
      ))}
    </div>
  )
}
