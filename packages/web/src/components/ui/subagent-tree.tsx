import { cn } from 'cn'
import { ChevronRight } from 'lucide-react'
import type * as React from 'react'

export type AgentRunStatus = 'running' | 'done' | 'failed'

export type AgentRun = {
  id: string
  label: string
  status: AgentRunStatus
  meta?: React.ReactNode
  duration?: string | undefined
  selectable: boolean
}

export type SubagentTreeProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'children' | 'onSelect'
> & {
  runs: readonly AgentRun[]
  label?: string
  onSelectRun: (run: AgentRun) => void
}

const CHEVRON_SIZE = 14

const summaryOf = (runs: readonly AgentRun[]): string => {
  const running = runs.filter((run) => run.status === 'running').length
  const failed = runs.filter((run) => run.status === 'failed').length

  if (running > 0) {
    return `${running} of ${runs.length} subagents running`
  }

  return failed > 0
    ? `${runs.length} subagents finished, ${failed} failed`
    : `${runs.length} subagents finished`
}

export function RunDot({ status }: { status: AgentRunStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-[9px] shrink-0 rounded-full',
        status === 'running' && 'bg-primary animate-pulse motion-reduce:animate-none',
        status === 'done' && 'bg-muted-foreground/40',
        status === 'failed' && 'bg-destructive',
      )}
    />
  )
}

function RunLine({ run }: { run: AgentRun }) {
  return (
    <>
      <RunDot status={run.status} />
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm">{run.label}</span>
        {run.meta === undefined ? null : (
          <span className="text-muted-foreground block truncate font-mono text-[0.6875rem] leading-4">
            {run.meta}
          </span>
        )}
      </span>
      <span className="sr-only">, {run.status}</span>
      {run.duration === undefined ? null : (
        <span className="text-muted-foreground shrink-0 font-mono text-[0.6875rem] tabular-nums">
          {run.duration}
        </span>
      )}
    </>
  )
}

export function SubagentTree({
  runs,
  label = 'Subagents',
  onSelectRun,
  className,
  ...rootProps
}: SubagentTreeProps) {
  const done = runs.filter((run) => run.status === 'done').length
  const failed = runs.filter((run) => run.status === 'failed').length

  return (
    <div
      data-slot="subagent-tree"
      data-running={runs.some((run) => run.status === 'running') || undefined}
      className={cn(
        'border-border bg-card w-full rounded-[var(--radius)] border p-3 pb-1.5',
        className,
      )}
      {...rootProps}
    >
      <p className="text-muted-foreground mb-1 flex items-baseline gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="ms-auto tabular-nums">
          {done}/{runs.length} done
          {failed > 0 ? <span className="text-destructive ms-2">{failed} failed</span> : null}
        </span>
      </p>
      <ul>
        {runs.map((run) => (
          <li key={run.id} data-status={run.status} data-run={run.id}>
            {run.selectable ? (
              <button
                type="button"
                className="focus-visible:ring-ring -mx-1.5 flex min-h-11 w-[calc(100%+0.75rem)] touch-manipulation items-center gap-2 rounded-md px-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
                onClick={() => {
                  onSelectRun(run)
                }}
              >
                <RunLine run={run} />
                <ChevronRight
                  aria-hidden="true"
                  size={CHEVRON_SIZE}
                  className="text-muted-foreground shrink-0"
                />
              </button>
            ) : (
              <p className="flex min-h-11 items-center gap-2">
                <RunLine run={run} />
              </p>
            )}
          </li>
        ))}
      </ul>
      <span aria-live="polite" className="sr-only">
        {summaryOf(runs)}
      </span>
    </div>
  )
}
