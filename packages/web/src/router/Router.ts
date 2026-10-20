import { createRouter } from '@tanstack/react-router'

import { remountWhenParamsChange } from '@crook/web/navigation/Pushed'
import { ROUTE_FALLBACKS } from '@crook/web/router/RouteFallbacks'
import { routeTree } from '@crook/web/routeTree.gen'

export const router = createRouter({
  routeTree,
  defaultRemountDeps: remountWhenParamsChange,
  ...ROUTE_FALLBACKS,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
