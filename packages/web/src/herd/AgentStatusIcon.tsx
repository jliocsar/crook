import CheckCircleIcon from '@heroicons/react/20/solid/CheckCircleIcon'
import HandRaisedIcon from '@heroicons/react/20/solid/HandRaisedIcon'
import PauseCircleIcon from '@heroicons/react/20/solid/PauseCircleIcon'
import QuestionMarkCircleIcon from '@heroicons/react/20/solid/QuestionMarkCircleIcon'
import SparklesIcon from '@heroicons/react/20/solid/SparklesIcon'
import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import type * as React from 'react'

import type { AgentStatus } from '@crook/domain/AgentStatus'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { SPRING } from '@crook/web/motion/Springs'
import { scale, useTransformString } from '@crook/web/motion/TransformString'

const POP_FROM = 0.55

const STATUS_ICON = {
  working: SparklesIcon,
  blocked: HandRaisedIcon,
  done: CheckCircleIcon,
  idle: PauseCircleIcon,
  unknown: QuestionMarkCircleIcon,
} satisfies Record<AgentStatus, React.ComponentType<React.ComponentProps<'svg'>>>

const STATUS_ICON_TONE = {
  working: 'text-primary animate-breathe motion-reduce:animate-none',
  blocked: 'text-warning',
  done: 'text-[color-mix(in_oklab,var(--accent)_85%,var(--foreground))]',
  idle: 'text-[color-mix(in_oklab,var(--muted-foreground)_75%,var(--background))]',
  unknown: 'text-[color-mix(in_oklab,var(--muted-foreground)_40%,var(--background))]',
} satisfies Record<AgentStatus, string>

export function AgentStatusIcon({ status }: { status: AgentStatus }) {
  const transform = useTransformString()
  const Icon = STATUS_ICON[status]

  return (
    <span aria-hidden="true" data-slot="status-icon" className="relative size-5 shrink-0">
      <AnimatePresence initial={false}>
        <motion.span
          key={status}
          data-status={status}
          className="absolute inset-0"
          initial={{ opacity: 0, transform: transform.scale(POP_FROM) }}
          animate={{ opacity: 1, transform: scale(1) }}
          exit={motionTokens().exit}
          transition={SPRING}
        >
          <Icon className={cn('block size-full', STATUS_ICON_TONE[status])} />
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
