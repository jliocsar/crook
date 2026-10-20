import { LogIn } from 'lucide-react'
import * as React from 'react'

import { Button } from '@crook/web/components/ui/button'
import { COLUMN_MAX_WIDTH } from '@crook/web/navigation/Column'

export type LoggedOutReason = 'loggedOut' | 'expired'

const COPY = {
  loggedOut: {
    title: "You're logged out",
    body: 'Your agents are still running. Log in to see them again.',
  },
  expired: {
    title: 'Your session expired',
    body: 'Your agents kept running. Log in again to see them.',
  },
} satisfies Record<LoggedOutReason, { readonly title: string; readonly body: string }>

export function LoggedOutScreen({
  reason,
  onLogIn,
}: {
  reason: LoggedOutReason
  onLogIn: () => void
}) {
  const heading = React.useRef<HTMLHeadingElement>(null)

  React.useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <main
      style={{ maxWidth: COLUMN_MAX_WIDTH }}
      className="mx-auto flex h-dvh flex-col items-center justify-center gap-3 px-6 pt-[var(--safe-top)] pb-[var(--safe-bottom)] text-center"
    >
      <span
        aria-hidden="true"
        className="border-border bg-muted/60 text-muted-foreground mb-1 flex size-11 items-center justify-center rounded-full border"
      >
        <LogIn className="size-5" />
      </span>
      <h1 ref={heading} tabIndex={-1} className="text-base font-medium outline-none">
        {COPY[reason].title}
      </h1>
      <p className="text-muted-foreground max-w-[42ch] text-sm leading-relaxed">
        {COPY[reason].body}
      </p>
      <Button size="touch" className="mt-2 text-base" onClick={onLogIn}>
        Log in with exe.dev
      </Button>
    </main>
  )
}
