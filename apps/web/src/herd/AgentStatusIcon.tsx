import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import type * as React from 'react'

import type { AgentStatus } from '@crook/domain/AgentStatus'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { SPRING } from '@crook/web/motion/Springs'
import { scale, useTransformString } from '@crook/web/motion/TransformString'

const POP_FROM = 0.55
const BREATHING = 'animate-breathe motion-reduce:animate-none'

const STATUS_ICON_PATH = {
  working: (
    <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
  ),
  blocked: (
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M11 2a1 1 0 1 0-2 0v6.5a.5.5 0 0 1-1 0V3a1 1 0 1 0-2 0v5.5a.5.5 0 0 1-1 0V5a1 1 0 1 0-2 0v7a7 7 0 1 0 14 0V8a1 1 0 1 0-2 0v3.5a.5.5 0 0 1-1 0V3a1 1 0 1 0-2 0v5.5a.5.5 0 0 1-1 0V2Z"
    />
  ),
  done: (
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
    />
  ),
  idle: (
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M2 10a8 8 0 1 1 16 0 8 8 0 0 1-16 0Zm5-2.25A.75.75 0 0 1 7.75 7h.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75v-4.5Zm4 0a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1-.75-.75v-4.5Z"
    />
  ),
  unknown: (
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.94 6.94a.75.75 0 1 1-1.061-1.061 3 3 0 1 1 2.871 5.026v.345a.75.75 0 0 1-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 1 0 8.94 6.94ZM10 15a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
    />
  ),
} satisfies Record<AgentStatus, React.ReactElement>

const STATUS_ICON_TONE = {
  working: 'text-primary',
  blocked: 'text-warning',
  done: 'text-[color-mix(in_oklab,var(--accent)_85%,var(--foreground))]',
  idle: 'text-[color-mix(in_oklab,var(--muted-foreground)_75%,var(--background))]',
  unknown: 'text-[color-mix(in_oklab,var(--muted-foreground)_40%,var(--background))]',
} satisfies Record<AgentStatus, string>

export function AgentStatusIcon({
  status,
  still = false,
  sizeClass = 'size-5',
}: {
  status: AgentStatus
  still?: boolean
  sizeClass?: string
}) {
  const transform = useTransformString()

  return (
    <span aria-hidden="true" data-slot="status-icon" className={cn('relative shrink-0', sizeClass)}>
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
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className={cn(
              'block size-full transition-colors duration-(--motion) ease-(--ease-out)',
              STATUS_ICON_TONE[status],
              status === 'working' && !still && BREATHING,
            )}
          >
            {STATUS_ICON_PATH[status]}
          </svg>
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
