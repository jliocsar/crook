import { RouterProvider } from '@tanstack/react-router'
import * as Effect from 'effect/Effect'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@/index.css'
import { registerServiceWorker } from '@/pwa/RegisterServiceWorker'
import { router } from '@/router/Router'

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
