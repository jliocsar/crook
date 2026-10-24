import { cn } from 'cn'
import type * as React from 'react'

export function Dimmed({
  dimmed,
  className,
  children,
}: {
  dimmed: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-dimmed={dimmed}
      className={cn(
        'transition-opacity duration-(--motion) ease-(--ease-out)',
        dimmed && 'opacity-60',
        className,
      )}
    >
      {children}
    </div>
  )
}
