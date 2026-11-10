import * as React from 'react'

import { cn } from 'cn'

export type StatusTone = 'ok' | 'warn' | 'blocked' | 'down' | 'idle' | 'working' | 'unknown'

type StatusPillProps = Omit<React.HTMLAttributes<HTMLElement>, 'children'> & {
  children: React.ReactNode
  tone?: StatusTone
  plain?: boolean
}

export const STATUS_DOT = {
  ok: 'bg-accent',
  warn: 'bg-warning',
  blocked: 'bg-warning ring-2 ring-warning/35',
  down: 'bg-destructive',
  idle: 'bg-muted-foreground',
  working: 'bg-primary animate-pulse motion-reduce:animate-none',
  unknown: 'border border-muted-foreground/40',
} satisfies Record<StatusTone, string>

export function StatusPill({
  children,
  tone = 'ok',
  plain = false,
  className,
  ...rootProps
}: StatusPillProps) {
  return (
    <span
      data-slot="status-pill"
      data-tone={tone}
      className={cn(
        'inline-flex items-center text-xs',
        plain
          ? 'text-muted-foreground'
          : 'border-border bg-card text-muted-foreground min-h-8 rounded-full border px-2.5',
        className,
      )}
      {...rootProps}
    >
      <span className="whitespace-nowrap">
        <span
          aria-hidden="true"
          data-slot="status-pill-dot"
          className={cn('mr-2 inline-block size-1.5 rounded-full align-middle', STATUS_DOT[tone])}
        />
        {children}
      </span>
    </span>
  )
}
