import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import type * as React from 'react'

import { motionTokens } from '@crook/web/motion/MotionTokens'
import { translate, useTransformString } from '@crook/web/motion/TransformString'

const SWAP_TRAVEL_PERCENT = 40

export function Swap({
  id,
  children,
  className,
}: {
  id: string
  children: React.ReactNode
  className?: string | undefined
}) {
  const transform = useTransformString()

  return (
    <span className={cn('relative inline-flex', className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={id}
          className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap"
          initial={{ opacity: 0, transform: transform.translate('Y', SWAP_TRAVEL_PERCENT, '%') }}
          animate={{ opacity: 1, transform: translate('Y', 0, '%') }}
          exit={{ opacity: 0, transform: transform.translate('Y', -SWAP_TRAVEL_PERCENT, '%') }}
          transition={motionTokens().fade}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}
