import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import { AnimatePresence, motion } from 'motion/react'
import type * as React from 'react'

import { Pin, PinOff, X } from 'lucide-react'

import { toGlobalPaneId } from '@crook/domain/Ids'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { usePinAgent } from '@crook/web/actions/PinAgent'
import { PaneAddress } from '@crook/web/atoms/AgentActions'
import { SwipeRow, useOpenRow } from '@crook/web/components/swipe/SwipeRow'
import type { OpenRow, SwipeAction } from '@crook/web/components/swipe/SwipeRow'
import { AgentCard } from '@crook/web/herd/AgentCard'
import { useHeldOrder } from '@crook/web/herd/HeldOrder'
import { SectionBody } from '@crook/web/herd/HerdLayout'
import type { AgentCardModel, HerdLayout, HerdNotice } from '@crook/web/herd/HerdLayout'
import { AllOffline, NoAgentsLine, NothingRunning, OfflineLine } from '@crook/web/herd/HerdNotices'
import { MachineSection } from '@crook/web/herd/MachineSection'
import { NoMachines } from '@crook/web/machines/NoMachines'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { SPRING } from '@crook/web/motion/Springs'

export type OpenAgent = (machine: MachineId, card: AgentCardModel, opener: HTMLElement) => void

export type OpenCardActions = (machine: MachineId, pane: PaneId) => void

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

function AgentCardRow({
  machine,
  card,
  now,
  row,
  controlsEnabled,
  onOpenAgent,
  onOpenActions,
}: {
  machine: MachineId
  card: AgentCardModel
  now: DateTime.Utc
  row: OpenRow
  controlsEnabled: boolean
  onOpenAgent: OpenAgent
  onOpenActions: OpenCardActions
}) {
  const { pane } = card.row
  const pin = usePinAgent(new PaneAddress({ machine, pane }), {
    pinned: card.pinned,
    controlsEnabled,
  })

  const openActions = () => {
    onOpenActions(machine, pane)
  }

  return (
    <motion.li
      layout="position"
      transition={SPRING}
      exit={motionTokens().exit}
      className="grid gap-2"
    >
      <SwipeRow
        id={toGlobalPaneId(machine, pane)}
        row={row}
        actions={[
          pinAction(card.pinned, pin.toggle, !controlsEnabled || pin.pending),
          closeAction(openActions, !controlsEnabled),
        ]}
        onTap={(opener) => {
          onOpenAgent(machine, card, opener)
        }}
        onLongPress={openActions}
      >
        <AgentCard card={card} now={now} />
      </SwipeRow>
      {Option.match(pin.failure, {
        onNone: () => null,
        onSome: (message) => (
          <p role="alert" className="text-destructive text-sm leading-5">
            {message}
          </p>
        ),
      })}
    </motion.li>
  )
}

export function AgentCards({
  machine,
  agents,
  now,
  row,
  controlsEnabled,
  onOpenAgent,
  onOpenActions,
}: {
  machine: MachineId
  agents: readonly AgentCardModel[]
  now: DateTime.Utc
  row: OpenRow
  controlsEnabled: boolean
  onOpenAgent: OpenAgent
  onOpenActions: OpenCardActions
}) {
  const ordered = useHeldOrder(agents, row.holding)

  return (
    <ul className="grid grid-cols-1 gap-2 px-4 pt-1">
      <AnimatePresence initial={false}>
        {ordered.map((card) => (
          <AgentCardRow
            key={card.row.pane}
            machine={machine}
            card={card}
            now={now}
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
  now,
  controlsEnabled,
  isOpen,
  onToggle,
  onOpenAgent,
  onOpenActions,
  onNewAgent,
  onAddMachine,
}: {
  layout: HerdLayout
  now: DateTime.Utc
  controlsEnabled: boolean
  isOpen: (machine: MachineId) => boolean
  onToggle: (machine: MachineId) => void
  onOpenAgent: OpenAgent
  onOpenActions: OpenCardActions
  onNewAgent: (opener: HTMLElement) => void
  onAddMachine: () => void
}) {
  const row = useOpenRow()

  return (
    <div data-slot="herd-list" className="grid grid-cols-1 gap-5 pt-2">
      {Option.match(layout.notice, {
        onNone: () => null,
        onSome: (notice) => HERD_NOTICE[notice]({ controlsEnabled, onNewAgent, onAddMachine }),
      })}
      {layout.sections.map((section) => (
        <MachineSection
          key={section.machine.id}
          section={section}
          now={now}
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
                now={now}
                row={row}
                controlsEnabled={controlsEnabled}
                onOpenAgent={onOpenAgent}
                onOpenActions={onOpenActions}
              />
            ),
            NoAgents: () => <NoAgentsLine />,
            Offline: () => <OfflineLine lastSeenAt={section.machine.lastSeenAt} now={now} />,
          })}
        </MachineSection>
      ))}
    </div>
  )
}
