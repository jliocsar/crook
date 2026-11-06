import { cn } from 'cn'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import { Pin } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type * as React from 'react'

import { agentTitleOrChat } from '@crook/domain/AgentRow'
import { AgentStatusIcon } from '@crook/web/herd/AgentStatusIcon'
import { AgentStatusPill } from '@crook/web/herd/AgentStatusPill'
import type { AgentCardModel } from '@crook/web/herd/HerdLayout'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { INSTANT } from '@crook/web/motion/Springs'

const MOST_RUN_DOTS = 3

export const ASKING_BORDER = 'border-[color-mix(in_oklab,var(--warning)_45%,var(--border))]'

const KEPT_ROW_TONE =
  'text-muted-foreground [--accent:var(--muted-foreground)] [--primary:var(--muted-foreground)] [--warning:var(--muted-foreground)]'

function Reveal({ id, children }: { id: string; children: React.ReactNode }) {
  const reduce = useReducedMotion() ?? false
  const tokens = motionTokens()

  return (
    <AnimatePresence initial={false}>
      <motion.span
        key={id}
        className="block overflow-hidden"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0, transition: reduce ? INSTANT : tokens.tap }}
        transition={reduce ? INSTANT : tokens.fade}
      >
        {children}
      </motion.span>
    </AnimatePresence>
  )
}

function RunningSubagents({ count }: { count: number }) {
  return (
    <span
      data-slot="running-subagents"
      className="text-muted-foreground inline-flex shrink-0 items-center gap-1.5 font-mono text-[12px] tabular-nums"
    >
      <span aria-hidden="true" className="flex gap-[3px]">
        {Arr.makeBy(Math.min(count, MOST_RUN_DOTS), (dot) => (
          <span key={dot} className="bg-primary size-[5px] rounded-full" />
        ))}
      </span>
      {count}
      <span className="sr-only">{count === 1 ? ' subagent running' : ' subagents running'}</span>
    </span>
  )
}

function AgentMeta({ card }: { card: AgentCardModel }) {
  const { row } = card

  return (
    <span className="flex min-w-0 items-center gap-2">
      <AgentStatusPill
        status={row.status}
        since={row.statusChangedAt}
        stoppedAt={card.herdrLostAt}
      />
      {Option.match(row.branch, {
        onNone: () => null,
        onSome: (branch) => (
          <span className="text-muted-foreground min-w-0 truncate font-mono text-[12px]">
            {branch}
          </span>
        ),
      })}
      {Option.match(
        Option.filter(row.runningSubagents, (count) => count > 0),
        {
          onNone: () => null,
          onSome: (count) => <RunningSubagents count={count} />,
        },
      )}
    </span>
  )
}

function AgentAsk({ card, summary }: { card: AgentCardModel; summary: string }) {
  return (
    <span className="flex flex-col items-start gap-1.5">
      <AgentStatusPill
        status={card.row.status}
        since={card.row.statusChangedAt}
        stoppedAt={card.herdrLostAt}
      />
      <span
        data-slot="ask-summary"
        className="text-foreground inline-block max-w-full truncate rounded-[12px_12px_12px_4px] bg-[color-mix(in_oklab,var(--warning)_14%,var(--card))] px-2.5 py-1.5 font-mono text-[12px] leading-4"
      >
        {summary}
      </span>
    </span>
  )
}

export function AgentCard({ card }: { card: AgentCardModel }) {
  const { row, needsYou } = card
  const kept = Option.isSome(card.herdrLostAt)

  return (
    <span
      data-slot="agent-card"
      data-kept={kept ? '' : undefined}
      className={cn('flex min-w-0 flex-1 flex-col gap-1.5', kept && KEPT_ROW_TONE)}
    >
      <span
        data-slot="agent-place"
        className="text-muted-foreground flex min-w-0 items-center gap-1 text-[12px] leading-4"
      >
        <span className="text-foreground/70 truncate font-medium">{card.workspace}</span>
        <span aria-hidden="true" className="opacity-50">
          /
        </span>
        <span className="truncate">{card.tab}</span>
        {card.pinned ? (
          <Pin
            role="img"
            aria-label="Pinned"
            data-slot="pin-marker"
            className="ms-auto size-3.5 shrink-0"
          />
        ) : null}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <AgentStatusIcon status={row.status} still={kept} />
        <span
          data-slot="agent-title"
          className={cn(
            'font-display min-w-0 truncate text-[17px] leading-6 tracking-[-0.01em] transition-colors duration-(--motion) ease-(--ease-out)',
            needsYou ? 'font-semibold' : 'font-medium',
          )}
        >
          {agentTitleOrChat(row)}
        </span>
      </span>
      {Option.match(card.askSummary, {
        onNone: () => (
          <Reveal id="meta">
            <AgentMeta card={card} />
          </Reveal>
        ),
        onSome: (summary) => (
          <Reveal id="ask">
            <AgentAsk card={card} summary={summary} />
          </Reveal>
        ),
      })}
    </span>
  )
}
