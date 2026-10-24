import { cn } from 'cn'
import * as Option from 'effect/Option'
import { Check, ChevronRight, Circle, CircleDot, Loader, TriangleAlert } from 'lucide-react'
import * as React from 'react'

import { useRowFlag } from '@crook/web/components/RowMemory'

export type ToolCallStatus = 'running' | 'waiting' | 'success' | 'error' | 'stopped'

type ToolCallProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> & {
  name: string
  status: ToolCallStatus
  icon: React.ReactNode
  duration?: string | undefined
  panel: React.ReactNode
  footer: Option.Option<React.ReactNode>
}

const STATUS_TEXT = {
  running: 'running',
  waiting: 'waiting for you',
  success: 'done',
  error: 'failed',
  stopped: 'stopped',
} satisfies Record<ToolCallStatus, string>

const ICON_SIZE = 15
const CHEVRON_SIZE = 14

function StatusIcon({ status }: { status: ToolCallStatus }) {
  if (status === 'running') {
    return (
      <Loader
        aria-hidden="true"
        size={ICON_SIZE}
        className="text-muted-foreground animate-spin motion-reduce:animate-none"
      />
    )
  }

  if (status === 'success') {
    return <Check aria-hidden="true" size={ICON_SIZE} className="text-accent" />
  }

  if (status === 'error') {
    return <TriangleAlert aria-hidden="true" size={ICON_SIZE} className="text-destructive" />
  }

  if (status === 'waiting') {
    return <CircleDot aria-hidden="true" size={ICON_SIZE} className="text-primary" />
  }

  return <Circle aria-hidden="true" size={ICON_SIZE} className="text-muted-foreground" />
}

export function ToolCall({
  name,
  status,
  icon,
  duration,
  panel,
  footer,
  className,
  ...rootProps
}: ToolCallProps) {
  const panelId = `${React.useId()}-panel`
  const [open, setOpen] = useRowFlag('tool-call', false)

  return (
    <div
      data-slot="tool-call"
      data-status={status}
      className={cn(
        'border-border bg-card text-card-foreground min-w-0 rounded-[var(--radius)] border',
        className,
      )}
      {...rootProps}
    >
      <button
        type="button"
        data-slot="tool-call-header"
        aria-expanded={open}
        aria-controls={panelId}
        className="focus-visible:ring-ring flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-[inherit] px-3.5 text-left focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => {
          setOpen(!open)
        }}
      >
        <span aria-hidden="true" className="text-muted-foreground shrink-0">
          {icon}
        </span>
        <span
          data-slot="tool-call-name"
          className="min-w-0 truncate font-[family-name:var(--font-mono),monospace] text-sm font-medium"
        >
          {name}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {duration === undefined ? null : (
            <span
              data-slot="tool-call-duration"
              className="text-muted-foreground font-[family-name:var(--font-mono),monospace] text-xs tabular-nums"
            >
              {duration}
            </span>
          )}
          <StatusIcon status={status} />
          <span className="sr-only">{STATUS_TEXT[status]}</span>
          <ChevronRight
            aria-hidden="true"
            size={CHEVRON_SIZE}
            className={cn(
              'text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
        </span>
      </button>
      {Option.match(footer, {
        onNone: () => null,
        onSome: (content) => (
          <div data-slot="tool-call-footer" className="px-3.5 pb-3">
            {content}
          </div>
        ),
      })}
      {open ? (
        <div
          id={panelId}
          data-slot="tool-call-panel"
          className="border-border grid min-w-0 gap-3 border-t px-3.5 py-3 text-sm leading-relaxed"
        >
          {panel}
        </div>
      ) : null}
    </div>
  )
}
