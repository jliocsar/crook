import { cn } from 'cn'
import type * as React from 'react'

type MessageProps = React.HTMLAttributes<HTMLElement> & {
  meta?: React.ReactNode
}

export function Message({ meta, children, className, ...rootProps }: MessageProps) {
  return (
    <article
      data-slot="message"
      data-role="user"
      className={cn('flex flex-row-reverse gap-3 px-1 py-1', className)}
      {...rootProps}
    >
      <div className="flex min-w-0 flex-col items-end gap-1">
        <p className="sr-only">You</p>
        <div
          data-slot="message-body"
          className="bg-muted max-w-[42rem] min-w-0 rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-left text-base leading-6 break-words whitespace-pre-wrap"
        >
          {children}
        </div>
        {meta === undefined ? null : (
          <div data-slot="message-meta" className="text-muted-foreground text-xs">
            {meta}
          </div>
        )}
      </div>
    </article>
  )
}
