import { cn } from 'cn'
import type * as DateTime from 'effect/DateTime'
import * as Str from 'effect/String'

import type { AgentStatus } from '@crook/domain/AgentStatus'
import { STATUS_WORD } from '@crook/web/components/StatusWord'
import { Swap } from '@crook/web/components/Swap'
import { clockElapsed, shortElapsed } from '@crook/web/time/Elapsed'

const STATUS_PILL_TONE = {
  working: 'bg-primary/12 text-[color-mix(in_oklab,var(--primary)_88%,var(--foreground))]',
  blocked: 'bg-warning/18 text-[color-mix(in_oklab,var(--warning)_72%,var(--foreground))]',
  done: 'bg-accent/22 text-[color-mix(in_oklab,var(--accent)_58%,var(--foreground))]',
  idle: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted/70 text-muted-foreground/75',
} satisfies Record<AgentStatus, string>

const isLive = (status: AgentStatus): boolean => status === 'working' || status === 'blocked'

export function AgentStatusPill({
  status,
  since,
  now,
}: {
  status: AgentStatus
  since: DateTime.Utc
  now: DateTime.Utc
}) {
  return (
    <span
      data-slot="agent-status"
      data-status={status}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] leading-none font-semibold whitespace-nowrap transition-colors duration-(--motion) ease-(--ease-out)',
        STATUS_PILL_TONE[status],
      )}
    >
      <Swap id={status}>{Str.capitalize(STATUS_WORD[status])}</Swap>
      {isLive(status) ? (
        <>
          <span
            aria-hidden="true"
            className="font-mono text-[11.5px] font-normal tabular-nums opacity-80"
          >
            {clockElapsed(now, since)}
          </span>
          <span className="sr-only">{shortElapsed(now, since)}</span>
        </>
      ) : (
        <span className="font-mono text-[11.5px] font-normal tabular-nums opacity-80">
          {shortElapsed(now, since)}
        </span>
      )}
    </span>
  )
}
