import { cn } from 'cn'
import type * as React from 'react'

export interface AboutRow {
  readonly label: string
  readonly value: React.ReactNode
}

export function SectionLabel({
  id,
  className,
  children,
}: {
  id?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <h2
      id={id}
      className={cn(
        'text-muted-foreground px-4 pb-2 text-xs font-bold tracking-[0.08em] uppercase',
        className,
      )}
    >
      {children}
    </h2>
  )
}

export function InfoList({ rows }: { rows: readonly AboutRow[] }) {
  return (
    <dl className="border-border border-t">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex min-h-11 items-center justify-between gap-4 px-4 py-2.5"
        >
          <dt className="text-muted-foreground shrink-0 text-sm">{row.label}</dt>
          <dd className="min-w-0 text-right font-mono text-sm break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
