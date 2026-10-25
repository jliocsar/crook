import { cn } from 'cn'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import { GitBranch, Pin } from 'lucide-react'

import { agentTitleOrPane } from '@crook/domain/AgentRow'
import { StatusGlyph } from '@crook/web/components/StatusGlyph'
import type { AgentCardModel } from '@crook/web/herd/HerdLayout'
import { shortElapsed } from '@crook/web/time/Elapsed'

export function AgentCard({ card, now }: { card: AgentCardModel; now: DateTime.Utc }) {
  const { row, needsYou } = card

  return (
    <span data-slot="agent-card" className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <span
          data-slot="agent-title"
          className={cn(
            'min-w-0 flex-1 truncate text-base leading-[22px]',
            needsYou ? 'font-semibold' : 'font-medium',
          )}
        >
          {agentTitleOrPane(row)}
        </span>
        {card.pinned ? (
          <Pin
            role="img"
            aria-label="Pinned"
            data-slot="pin-marker"
            className="text-muted-foreground size-3.5 shrink-0"
          />
        ) : null}
        <span
          className={cn(
            'shrink-0 font-mono text-xs tabular-nums',
            needsYou ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {shortElapsed(now, row.statusChangedAt)}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-2.5">
        <StatusGlyph status={row.status} />
        <span
          data-slot="agent-place"
          className="text-muted-foreground inline-flex min-w-0 items-center gap-1.5 truncate text-[13px] leading-[18px]"
        >
          <span className="text-foreground/80 font-medium">{card.workspace}</span>
          <span aria-hidden="true" className="opacity-50">
            ›
          </span>
          <span className="truncate">{card.tab}</span>
        </span>
        {Option.match(row.branch, {
          onNone: () => null,
          onSome: (branch) => (
            <span className="text-muted-foreground inline-flex min-w-0 items-center gap-1 font-mono text-xs">
              <GitBranch aria-hidden="true" className="size-3 shrink-0" />
              <span className="truncate">{branch}</span>
            </span>
          ),
        })}
      </span>
      {Option.match(card.askSummary, {
        onNone: () => null,
        onSome: (summary) => (
          <span className="mt-0.5 grid justify-items-start gap-[3px]">
            <span className="text-muted-foreground pl-0.5 text-[11px] leading-[14px]">
              claude asks
            </span>
            <span
              data-slot="ask-summary"
              className="text-foreground max-w-full truncate rounded-[12px_12px_12px_4px] bg-[color-mix(in_oklab,var(--warning)_12%,var(--muted))] px-2.5 py-1.5 font-mono text-[11px] leading-4"
            >
              {summary}
            </span>
          </span>
        ),
      })}
    </span>
  )
}
