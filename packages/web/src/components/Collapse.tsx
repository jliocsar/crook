import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import * as React from 'react'

import { SPRING } from '@crook/web/motion/Springs'

function CollapseBody({ children }: { children: React.ReactNode }) {
  const [clipping, setClipping] = React.useState(false)
  const present = useIsPresent()

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={SPRING}
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
