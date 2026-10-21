import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import { AnimatePresence, motion } from 'motion/react'
import type * as React from 'react'

import type { MachineId } from '@crook/domain/Ids'
import { Pressable } from '@crook/web/components/press/Pressable'
import { AgentCard } from '@crook/web/herd/AgentCard'
import { SectionBody } from '@crook/web/herd/HerdLayout'
import type { AgentCardModel, HerdLayout, HerdNotice } from '@crook/web/herd/HerdLayout'
import { AllOffline, NoAgentsLine, NothingRunning, OfflineLine } from '@crook/web/herd/HerdNotices'
import { MachineSection } from '@crook/web/herd/MachineSection'
import { NoMachines } from '@crook/web/machines/NoMachines'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { SPRING } from '@crook/web/motion/Springs'

export type OpenAgent = (machine: MachineId, card: AgentCardModel, opener: HTMLElement) => void

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

export function AgentCards({
  machine,
  agents,
  now,
  onOpenAgent,
}: {
  machine: MachineId
  agents: readonly AgentCardModel[]
  now: DateTime.Utc
  onOpenAgent: OpenAgent
}) {
  return (
    <ul className="grid grid-cols-1 gap-2 px-4 pt-1">
      <AnimatePresence initial={false}>
        {agents.map((card) => (
          <motion.li
            key={card.row.pane}
            layout="position"
            transition={SPRING}
            exit={motionTokens().exit}
          >
            <div className="bg-card border-border rounded-xl border">
              <Pressable
                frameClassName="rounded-xl"
                className="p-3"
                onTap={(opener) => {
                  onOpenAgent(machine, card, opener)
                }}
              >
                <AgentCard card={card} now={now} />
              </Pressable>
            </div>
          </motion.li>
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
  onNewAgent,
  onAddMachine,
}: {
  layout: HerdLayout
  now: DateTime.Utc
  controlsEnabled: boolean
  isOpen: (machine: MachineId) => boolean
  onToggle: (machine: MachineId) => void
  onOpenAgent: OpenAgent
  onNewAgent: (opener: HTMLElement) => void
  onAddMachine: () => void
}) {
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
                onOpenAgent={onOpenAgent}
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
