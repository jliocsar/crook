import type * as React from 'react'

export interface InfoListRow {
  readonly label: string
  readonly value: React.ReactNode
}

export function InfoList({ rows }: { rows: readonly InfoListRow[] }) {
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
