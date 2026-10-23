import * as React from 'react'

import { cn } from 'cn'

type SpinnerProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> & {
  size?: number
  label?: string
}

export function Spinner({ size = 16, label, className, ...rootProps }: SpinnerProps) {
  return (
    <span
      data-slot="spinner"
      role={label === undefined ? undefined : 'status'}
      aria-hidden={label === undefined ? 'true' : undefined}
      className={cn('inline-flex items-center', className)}
      {...rootProps}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        aria-hidden="true"
        className="animate-spin motion-reduce:animate-none"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="2.5"
          className="opacity-20"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {label === undefined ? null : <span className="sr-only">{label}</span>}
    </span>
  )
}
