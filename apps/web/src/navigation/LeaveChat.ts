import type { RegisteredRouter } from '@tanstack/react-router'
import * as Effect from 'effect/Effect'

const isOn = (router: RegisteredRouter, pathname: string): boolean =>
  router.state.location.pathname === pathname

const backThroughHistory = (router: RegisteredRouter) =>
  Effect.callback<void>((resume) => {
    const stop = router.subscribe('onResolved', () => {
      stop()
      resume(Effect.void)
    })

    router.history.back()

    return Effect.sync(stop)
  })

export const leaveChatFor = (router: RegisteredRouter, parent: string): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (isOn(router, parent)) {
      return Effect.void
    }

    if (!router.history.canGoBack()) {
      return Effect.promise(() => router.navigate({ href: parent, replace: true }))
    }

    return backThroughHistory(router).pipe(
      Effect.andThen(() =>
        isOn(router, parent)
          ? Effect.void
          : Effect.promise(() => router.navigate({ href: parent })),
      ),
    )
  })
