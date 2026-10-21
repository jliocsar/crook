import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import * as React from 'react'

import { INSTANT, SPRING } from '@crook/web/motion/Springs'

function CollapseBody({ children }: { children: React.ReactNode }) {
  const [clipping, setClipping] = React.useState(false)
  const present = useIsPresent()
  const reduce = useReducedMotion() ?? false

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={reduce ? INSTANT : SPRING}
      inert={!present}
      onAnimationStart={() => {
        setClipping(true)
      }}
      onAnimationComplete={() => {
        setClipping(false)
      }}
      style={{ overflow: clipping ? 'hidden' : 'visible' }}
    >
      {children}
    </motion.div>
  )
}

export function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open ? <CollapseBody key="body">{children}</CollapseBody> : null}
    </AnimatePresence>
  )
}
