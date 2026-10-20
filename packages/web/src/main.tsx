import { RouterProvider } from '@tanstack/react-router'
import * as Effect from 'effect/Effect'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@crook/web/index.css'
import { registerServiceWorker } from '@crook/web/pwa/RegisterServiceWorker'
import { router } from '@crook/web/router/Router'

const ROOT_ELEMENT_ID = 'root'

const root = document.getElementById(ROOT_ELEMENT_ID)

if (root) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}

Effect.runFork(registerServiceWorker)
