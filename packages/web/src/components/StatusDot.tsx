import type { AgentStatus } from '@crook/domain/AgentStatus'

import { AnimatePresence, motion } from 'motion/react'

import { AGENT_STATUS_TONE } from '@/components/AgentStatusTone'
import { STATUS_DOT } from '@/components/ui/status-pill'
import { cn } from 'cn'
import { motionTokens } from '@/motion/MotionTokens'
import { SPRING } from '@/motion/Springs'
import { scale, useTransformString } from '@/motion/TransformString'

const POP_FROM = 0.5

export function StatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  const transform = useTransformString()

  return (
    <span
      aria-hidden="true"
      data-slot="status-dot"
      className={cn('relative inline-block size-2 align-middle', className)}
    >
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
          <span
            className={cn('block size-full rounded-full', STATUS_DOT[AGENT_STATUS_TONE[status]])}
          />
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
