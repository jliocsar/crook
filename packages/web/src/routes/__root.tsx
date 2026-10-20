import { createRootRoute } from '@tanstack/react-router'
import { MotionConfig } from 'motion/react'

import { InstallGate } from '@crook/web/install/InstallGate'
import { Shell } from '@crook/web/navigation/Shell'

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
