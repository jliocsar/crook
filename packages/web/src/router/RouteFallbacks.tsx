import { Navigate } from '@tanstack/react-router'
import type { ErrorComponentProps } from '@tanstack/react-router'

import { Button } from '@crook/web/components/ui/button'
import { COLUMN_MAX_WIDTH } from '@crook/web/navigation/Column'

const HOME_PATHNAME = '/'

export const ROUTE_FALLBACKS = {
  defaultNotFoundComponent: NotFound,
  defaultErrorComponent: RouteError,
} as const

export function NotFound() {
  return <Navigate to={HOME_PATHNAME} replace />
}

export function RouteError({ error, reset }: ErrorComponentProps) {
  return (
    <main
      role="alert"
      style={{ maxWidth: COLUMN_MAX_WIDTH }}
      className="mx-auto flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <h1 className="font-display text-2xl font-bold tracking-[-0.025em]">Something broke</h1>
      <p className="text-muted-foreground text-base leading-6 text-pretty">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <Button size="touch" onClick={reset}>
        Try again
      </Button>
    </main>
  )
}
