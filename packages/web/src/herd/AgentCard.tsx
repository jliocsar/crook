import { cn } from 'cn'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import { Pin } from 'lucide-react'

import { agentTitleOrPane } from '@crook/domain/AgentRow'
import { StatusWord } from '@crook/web/components/StatusWord'
import type { AgentCardModel } from '@crook/web/herd/HerdLayout'
import { shortElapsed } from '@crook/web/time/Elapsed'

export function AgentCard({ card, now }: { card: AgentCardModel; now: DateTime.Utc }) {
  const { row, needsYou } = card
  const emphasis = needsYou ? 'text-foreground' : 'text-muted-foreground'

  return (
    <span data-slot="agent-card" className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-baseline gap-2">
        <span
          data-slot="agent-title"
          className={cn(
            'min-w-0 flex-1 truncate text-base leading-6',
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
            className="text-muted-foreground size-3.5 shrink-0 self-center"
          />
        ) : null}
        <span className={cn('shrink-0 font-mono text-xs tabular-nums', emphasis)}>
          {shortElapsed(now, row.statusChangedAt)}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-sm leading-5">
        <StatusWord status={row.status} className={cn('font-semibold', emphasis)} />
        <span aria-hidden="true" className="text-muted-foreground">
          ·
        </span>
        {Option.match(card.askSummary, {
          onNone: () => (
            <span className="text-muted-foreground truncate">
              {card.workspace} · {card.tab}
              {Option.match(row.branch, {
                onNone: () => null,
                onSome: (branch) => <span className="font-mono text-xs"> {branch}</span>,
              })}
            </span>
          ),
          onSome: (summary) => (
            <span data-slot="ask-summary" className="text-foreground truncate font-mono text-xs">
              {summary}
            </span>
          ),
        })}
      </span>
    </span>
  )
}
