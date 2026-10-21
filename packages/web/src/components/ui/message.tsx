import { cn } from 'cn'
import type * as React from 'react'

export type MessageRole = 'user' | 'assistant'

export type MessageProps = React.HTMLAttributes<HTMLElement> & {
  role: MessageRole
  name?: React.ReactNode
  meta?: React.ReactNode
}

const ROLE_NAME = { user: 'You', assistant: 'Claude' } satisfies Record<MessageRole, string>

export function Message({ role, name, meta, children, className, ...rootProps }: MessageProps) {
  return (
    <article
      data-slot="message"
      data-role={role}
      className={cn('flex gap-3 px-1 py-1', role === 'user' && 'flex-row-reverse', className)}
      {...rootProps}
    >
      <div
        className={cn('flex min-w-0 flex-col gap-1', role === 'user' ? 'items-end' : 'items-start')}
      >
        <p className="sr-only">{name ?? ROLE_NAME[role]}</p>
        <div
          data-slot="message-body"
          className={cn(
            'max-w-[42rem] min-w-0 text-base leading-6 break-words',
            role === 'user' &&
              'bg-muted rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-left whitespace-pre-wrap',
          )}
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
