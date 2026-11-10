import { createRootRoute } from '@tanstack/react-router'
import { MotionConfig } from 'motion/react'

import { HubGate } from '@crook/web/connection/HubGate'
import { InstallGate } from '@crook/web/install/InstallGate'

export const Route = createRootRoute({ component: Root })

function Root() {
  return (
    <MotionConfig reducedMotion="user">
      <InstallGate>
        <HubGate />
      </InstallGate>
    </MotionConfig>
  )
}
