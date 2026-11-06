import { cn } from 'cn'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Str from 'effect/String'

import type { AgentStatus } from '@crook/domain/AgentStatus'
import { STATUS_WORD } from '@crook/web/components/StatusWord'
import { Swap } from '@crook/web/components/Swap'
import { clockElapsed, shortElapsed } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

const STATUS_PILL_TONE = {
  working: 'bg-primary/12 text-[color-mix(in_oklab,var(--primary)_88%,var(--foreground))]',
  blocked: 'bg-warning/18 text-[color-mix(in_oklab,var(--warning)_72%,var(--foreground))]',
  done: 'bg-accent/22 text-[color-mix(in_oklab,var(--accent)_58%,var(--foreground))]',
  idle: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted/70 text-muted-foreground/75',
} satisfies Record<AgentStatus, string>

const isLive = (status: AgentStatus): boolean => status === 'working' || status === 'blocked'

const DRAWN_AS_ONE_BLOCK = { 'skullet-block': '' }

function ElapsedLabel({
  status,
  since,
  stoppedAt,
}: {
  status: AgentStatus
  since: DateTime.Utc
  stoppedAt: Option.Option<DateTime.Utc>
}) {
  const ticking = useNow(Option.isNone(stoppedAt))
  const now = Option.getOrElse(stoppedAt, () => ticking)
  const digits = cn(
    'font-mono text-[11.5px] font-normal tabular-nums',
    Option.isNone(stoppedAt) && 'opacity-80',
  )

  return isLive(status) ? (
    <>
      <span aria-hidden="true" className={digits}>
        {clockElapsed(now, since)}
      </span>
      <span className="sr-only">{shortElapsed(now, since)}</span>
    </>
  ) : (
    <span className={digits}>{shortElapsed(now, since)}</span>
  )
}

export function AgentStatusPill({
  status,
  since,
  stoppedAt,
}: {
  status: AgentStatus
  since: DateTime.Utc
  stoppedAt: Option.Option<DateTime.Utc>
}) {
  return (
    <span
      data-slot="agent-status"
      data-status={status}
      {...DRAWN_AS_ONE_BLOCK}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] leading-none font-semibold whitespace-nowrap transition-colors duration-(--motion) ease-(--ease-out)',
        STATUS_PILL_TONE[status],
      )}
    >
      <Swap id={status}>{Str.capitalize(STATUS_WORD[status])}</Swap>
      <ElapsedLabel status={status} since={since} stoppedAt={stoppedAt} />
    </span>
  )
}
