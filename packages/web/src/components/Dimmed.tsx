import { motion } from 'motion/react'
import type * as React from 'react'

import { motionTokens } from '@crook/web/motion/MotionTokens'

const STALE_OPACITY = 0.6

export function Dimmed({
  dimmed,
  className,
  children,
}: {
  dimmed: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <motion.div
      data-dimmed={dimmed}
      className={className}
      initial={false}
      animate={{ opacity: dimmed ? STALE_OPACITY : 1 }}
      transition={motionTokens().fade}
    >
      {children}
    </motion.div>
  )
}
