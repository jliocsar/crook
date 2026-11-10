import * as Option from 'effect/Option'
import { ChevronRight, Trash2 } from 'lucide-react'

import type { MachineId } from '@crook/domain/Ids'
import { isOffline } from '@crook/domain/Machine'
import { Pressable } from '@crook/web/components/press/Pressable'
import { SwipeRow, useOpenRow } from '@crook/web/components/swipe/SwipeRow'
import type { OpenRow, SwipeAction } from '@crook/web/components/swipe/SwipeRow'
import { useForgetMachine } from '@crook/web/machines/Forget'
import { MachineHeading } from '@crook/web/machines/MachineHeading'
import { agentSummary, versionsLine } from '@crook/web/machines/MachineLayout'
import type { MachineCardModel, MachinesLayout } from '@crook/web/machines/MachineLayout'
import { useFailureToast } from '@crook/web/toast/FailureToast'

export type OpenMachine = (machine: MachineId, opener: HTMLElement) => void

const OFFLINE_HINT = 'Swipe to forget, or wait for it to reconnect'

const forgetAction = (run: () => void, disabled: boolean): SwipeAction => ({
  label: 'Forget',
  icon: <Trash2 aria-hidden="true" className="size-4" />,
  tone: 'destructive',
  run,
  disabled,
})

function MachineCardBody({ card }: { card: MachineCardModel }) {
  return (
    <span data-slot="machine-card" className="flex min-w-0 flex-1 items-center gap-3">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <MachineHeading card={card} />
        <span className="text-muted-foreground text-sm leading-5">
          {isOffline(card.machine) ? OFFLINE_HINT : agentSummary(card)}
        </span>
        {Option.match(versionsLine(card.machine), {
          onNone: () => null,
          onSome: (line) => <span className="text-muted-foreground font-mono text-xs">{line}</span>,
        })}
      </span>
      <ChevronRight aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
    </span>
  )
}

function OnlineMachineRow({ card, onOpen }: { card: MachineCardModel; onOpen: OpenMachine }) {
  const open = (opener: HTMLElement) => {
    onOpen(card.machine.id, opener)
  }

  return (
    <li>
      <div className="bg-card border-border rounded-xl border">
        <Pressable frameClassName="rounded-xl" className="p-3" onTap={open}>
          <MachineCardBody card={card} />
        </Pressable>
      </div>
    </li>
  )
}

function OfflineMachineRow({
  card,
  row,
  controlsEnabled,
  onOpen,
}: {
  card: MachineCardModel
  row: OpenRow
  controlsEnabled: boolean
  onOpen: OpenMachine
}) {
  const { id, connection } = card.machine
  const forgetting = useForgetMachine(id, { connection, controlsEnabled })

  const open = (opener: HTMLElement) => {
    onOpen(id, opener)
  }

  useFailureToast(forgetting.failure)

  return (
    <li>
      <SwipeRow
        id={id}
        row={row}
        actions={[forgetAction(forgetting.forget, !controlsEnabled || forgetting.pending)]}
        onTap={open}
      >
        <MachineCardBody card={card} />
      </SwipeRow>
    </li>
  )
}

export function MachineList({
  layout,
  controlsEnabled,
  onOpen,
}: {
  layout: MachinesLayout
  controlsEnabled: boolean
  onOpen: OpenMachine
}) {
  const row = useOpenRow()

  return (
    <ul data-slot="machine-list" className="grid grid-cols-1 gap-2 px-4 pt-2">
      {layout.machines.map((card) =>
        isOffline(card.machine) ? (
          <OfflineMachineRow
            key={card.machine.id}
            card={card}
            row={row}
            controlsEnabled={controlsEnabled}
            onOpen={onOpen}
          />
        ) : (
          <OnlineMachineRow key={card.machine.id} card={card} onOpen={onOpen} />
        ),
      )}
    </ul>
  )
}
