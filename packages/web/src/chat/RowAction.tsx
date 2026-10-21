import type * as React from 'react'

export function RowAction({
  label,
  onAction,
  children,
}: {
  label: string
  onAction: () => void
  children: React.ReactNode
}) {
  return (
    <div className="grid justify-items-center gap-1 py-1">
      {children}
      <button
        type="button"
        className="text-primary inline-flex min-h-11 items-center px-3 text-sm font-semibold"
        onClick={onAction}
      >
        {label}
      </button>
    </div>
  )
}
