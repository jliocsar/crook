import type * as React from 'react'

import { Swap } from '@crook/web/components/Swap'
import { Spinner } from '@crook/web/components/ui/spinner'

const PENDING_SPINNER_SIZE = 14

export function RowAction({
  label,
  pendingLabel,
  pending,
  onAction,
  children,
}: {
  label: string
  pendingLabel: string
  pending: boolean
  onAction: () => void
  children: React.ReactNode
}) {
  const shown = pending ? pendingLabel : label

  return (
    <div className="grid justify-items-center gap-1 py-1">
      {children}
      <button
        type="button"
        aria-label={shown}
        aria-busy={pending}
        disabled={pending}
        className="text-primary disabled:text-muted-foreground inline-flex min-h-11 items-center px-3 text-sm font-semibold"
        onClick={onAction}
      >
        <span className="inline-flex items-center gap-1.5">
          <Spinner pending={pending} size={PENDING_SPINNER_SIZE} />
          <Swap id={shown}>{shown}</Swap>
        </span>
      </button>
    </div>
  )
}
