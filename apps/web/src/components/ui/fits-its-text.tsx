import * as React from 'react'

import { cn } from 'cn'

export const FITTED_FIELD = 'col-start-1 row-start-1 min-h-0 w-full resize-none overflow-y-auto'

export function FitsItsText({
  text,
  textClass,
  className,
  children,
}: {
  text: string
  textClass: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div data-slot="field-fit" className={cn('grid grid-cols-1', className)}>
      <div
        aria-hidden="true"
        data-fit-text={`${text} `}
        className={cn(
          'invisible col-start-1 row-start-1 overflow-hidden wrap-break-word whitespace-pre-wrap after:content-[attr(data-fit-text)]',
          textClass,
        )}
      />
      {children}
    </div>
  )
}
