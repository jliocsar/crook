import { cn } from 'cn'
import type * as React from 'react'

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
