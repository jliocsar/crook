import { createRootRoute } from '@tanstack/react-router'
import { MotionConfig } from 'motion/react'

import { InstallGate } from '@/install/InstallGate'
import { Shell } from '@/navigation/Shell'

export const Route = createRootRoute({ component: Root })

function Root() {
  return (
    <MotionConfig reducedMotion="user">
      <InstallGate>
        <Shell />
      </InstallGate>
    </MotionConfig>
  )
}
