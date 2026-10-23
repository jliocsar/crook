import type * as DateTime from 'effect/DateTime'

import { MachineBadge } from '@crook/web/components/MachineBadge'
import { StatusPill } from '@crook/web/components/ui/status-pill'
import type { MachineCardModel } from '@crook/web/machines/MachineLayout'

function UpdatePill({ behindHub }: { behindHub: boolean }) {
  if (!behindHub) {
    return null
  }

  return (
    <StatusPill tone="warn" plain className="shrink-0">
      update agent
    </StatusPill>
  )
}

export function MachineStatus({ card, now }: { card: MachineCardModel; now: DateTime.Utc }) {
  return (
    <>
      <MachineBadge machine={card.machine} now={now} plain />
      <UpdatePill behindHub={card.behindHub} />
    </>
  )
}

export function MachineHeading({ card, now }: { card: MachineCardModel; now: DateTime.Utc }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span
        data-slot="machine-label"
        className="font-display truncate text-xl leading-7 font-semibold tracking-[-0.015em]"
      >
        {card.machine.label}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3">
        <MachineStatus card={card} now={now} />
      </span>
    </span>
  )
}
