import type * as DateTime from 'effect/DateTime'
import { ChevronDown } from 'lucide-react'
import { motion } from 'motion/react'
import type * as React from 'react'

import { Collapse } from '@crook/web/components/Collapse'
import { Dimmed } from '@crook/web/components/Dimmed'
import { MachineBadge } from '@crook/web/components/MachineBadge'
import type { MachineSectionModel } from '@crook/web/herd/HerdLayout'
import { SPRING } from '@crook/web/motion/Springs'
import { needsYouLabel } from '@crook/web/herd/NeedsYouLabel'

const COLLAPSED_CHEVRON_DEGREES = -90

export function MachineSection({
  section,
  now,
  open,
  onToggle,
  children,
}: {
  section: MachineSectionModel
  now: DateTime.Utc
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const { machine, needsYou } = section

  return (
    <section data-slot="machine-section" className="grid grid-cols-1">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-h-11 w-full items-center gap-2 px-4 text-left"
        >
          <span className="font-display shrink-0 text-xl leading-7 font-semibold tracking-[-0.015em] whitespace-nowrap">
            {machine.label}
          </span>
          <MachineBadge machine={machine} now={now} plain />
          <span className="text-muted-foreground ml-auto truncate font-mono text-xs tabular-nums">
            {needsYou > 0 ? needsYouLabel(needsYou) : null}
          </span>
          <motion.span
            aria-hidden="true"
            className="text-muted-foreground inline-flex shrink-0"
            initial={false}
            animate={{ rotate: open ? 0 : COLLAPSED_CHEVRON_DEGREES }}
            transition={SPRING}
          >
            <ChevronDown className="size-4" />
          </motion.span>
        </button>
      </h2>
      <Collapse open={open}>
        <Dimmed dimmed={machine.connection === 'reconnecting'}>{children}</Dimmed>
      </Collapse>
    </section>
  )
}
