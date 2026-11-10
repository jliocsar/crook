import * as React from 'react'

import { cn } from 'cn'

type SkeletonProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  lines?: number
}

export function Skeleton({ lines, className, ...rootProps }: SkeletonProps) {
  const bar =
    'bg-muted animate-pulse rounded-[calc(var(--radius)-0.35rem)] motion-reduce:animate-none'

  if (lines === undefined) {
    return (
      <div
        aria-hidden="true"
        data-slot="skeleton"
        className={cn(bar, 'h-4 w-full', className)}
        {...rootProps}
      />
    )
  }

  return (
    <div
      aria-hidden="true"
      data-slot="skeleton"
      className={cn('grid gap-2', className)}
      {...rootProps}
    >
      {Array.from({ length: lines }, (_bar, index) => (
        <div key={index} className={cn(bar, 'h-4', index === lines - 1 && 'w-3/5')} />
      ))}
    </div>
  )
}
