import { LogIn } from 'lucide-react'
import * as React from 'react'

import { Button } from '@crook/web/components/ui/button'
import { EmptyStateIcon } from '@crook/web/components/ui/empty-state'
import { COLUMN_MAX_WIDTH } from '@crook/web/navigation/Column'

export function LoggedOutScreen({ onLogIn }: { onLogIn: () => void }) {
  const heading = React.useRef<HTMLHeadingElement>(null)

  React.useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <main
      style={{ maxWidth: COLUMN_MAX_WIDTH }}
      className="mx-auto flex h-dvh flex-col items-center justify-center gap-3 px-6 pt-[var(--safe-top)] pb-[var(--safe-bottom)] text-center"
    >
      <EmptyStateIcon>
        <LogIn className="size-5" />
      </EmptyStateIcon>
      <h1 ref={heading} tabIndex={-1} className="text-base font-medium outline-none">
        Your session expired
      </h1>
      <p className="text-muted-foreground max-w-[42ch] text-sm leading-relaxed">
        Your agents kept running. Log in again to see them.
      </p>
      <Button size="touch" className="mt-2 text-base" onClick={onLogIn}>
        Log in with exe.dev
      </Button>
    </main>
  )
}
