import type { RegisteredRouter } from '@tanstack/react-router'
import * as Effect from 'effect/Effect'

const HERD_PATH = '/'

const isOnHerd = (router: RegisteredRouter): boolean => router.state.location.pathname === HERD_PATH

const backThroughHistory = (router: RegisteredRouter) =>
  Effect.callback<void>((resume) => {
    const stop = router.subscribe('onResolved', () => {
      stop()
      resume(Effect.void)
    })

    router.history.back()

    return Effect.sync(stop)
  })

export const leaveForHerd = (router: RegisteredRouter): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (isOnHerd(router)) {
      return Effect.void
    }

    if (!router.history.canGoBack()) {
      return Effect.promise(() => router.navigate({ to: HERD_PATH, replace: true }))
    }

    return backThroughHistory(router).pipe(
      Effect.andThen(() =>
        isOnHerd(router) ? Effect.void : Effect.promise(() => router.navigate({ to: HERD_PATH })),
      ),
    )
  })
