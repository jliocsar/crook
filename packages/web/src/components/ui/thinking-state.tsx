import { cn } from 'cn'
import type * as React from 'react'

import { Spinner } from '@crook/web/components/ui/spinner'

type ThinkingStateProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  label: React.ReactNode
  elapsed?: string | undefined
}

const ICON_SIZE = 16

export function ThinkingState({ label, elapsed, className, ...rootProps }: ThinkingStateProps) {
  return (
    <div
      data-slot="thinking-state"
      aria-busy="true"
      className={cn(
        'border-border bg-muted/40 text-foreground rounded-[var(--radius)] border',
        className,
      )}
      {...rootProps}
    >
      <div data-slot="thinking-state-header" className="flex items-center gap-2.5 px-3.5 py-2.5">
        <Spinner holdsRoom size={ICON_SIZE} className="text-muted-foreground shrink-0" />
        <span
          data-slot="thinking-state-label"
          className="animate-pulse text-sm font-semibold motion-reduce:animate-none"
        >
          {label}
        </span>
        {elapsed === undefined ? null : (
          <span
            data-slot="thinking-state-elapsed"
            className="text-muted-foreground font-[family-name:var(--font-mono),monospace] text-xs tabular-nums"
          >
            {elapsed}
          </span>
        )}
      </div>
    </div>
  )
}
