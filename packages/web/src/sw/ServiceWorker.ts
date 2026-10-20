import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import type { PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

import { EXE_DEV_PATHS } from '../connection/ExeDevPaths.ts'

declare const self: ServiceWorkerGlobalScope & {
  readonly precacheManifest: (PrecacheEntry | string)[]
}

const APP_SHELL = '/index.html'

cleanupOutdatedCaches()
precacheAndRoute(self.precacheManifest)
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(APP_SHELL), { denylist: [EXE_DEV_PATHS] }),
)
