import * as React from 'react'

import { cn } from 'cn'

export type EmptyStateProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  actions?: React.ReactNode
  size?: 'sm' | 'md'
}

export function EmptyStateIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="border-border bg-muted/60 text-muted-foreground mb-1 flex size-11 items-center justify-center rounded-full border"
    >
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  icon,
  actions,
  size = 'md',
  children,
  className,
  ...rootProps
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'border-border/70 flex flex-col items-center justify-center rounded-[calc(var(--radius)+0.15rem)] border border-dashed text-center',
        size === 'sm' ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14',
        className,
      )}
      {...rootProps}
    >
      {icon === undefined ? null : <EmptyStateIcon>{icon}</EmptyStateIcon>}

      <p className="text-foreground text-sm font-medium">{title}</p>

      {description === undefined ? null : (
        <p className="text-muted-foreground max-w-[42ch] text-sm leading-relaxed">{description}</p>
      )}

      {actions === undefined ? null : (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div>
      )}

      {children}
    </div>
  )
}
