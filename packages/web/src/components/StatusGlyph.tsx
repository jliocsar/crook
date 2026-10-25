import type { AgentStatus } from '@crook/domain/AgentStatus'

import { cn } from 'cn'
import { Check, CircleQuestionMark, LoaderCircle, Pause } from 'lucide-react'
import type { LucideProps } from 'lucide-react'
import type * as React from 'react'

import { STATUS_WORD } from '@crook/web/components/StatusWord'
import { Swap } from '@crook/web/components/Swap'

const STATUS_GLYPH_TONE = {
  blocked: {
    circle: 'bg-warning/15 text-[color-mix(in_oklab,var(--warning)_80%,var(--foreground))]',
    word: 'text-[color-mix(in_oklab,var(--warning)_65%,var(--foreground))] font-semibold',
  },
  working: {
    circle: 'bg-primary/15 text-[color-mix(in_oklab,var(--primary)_80%,var(--foreground))]',
    word: 'text-muted-foreground font-medium',
  },
  done: {
    circle: 'bg-accent/15 text-[color-mix(in_oklab,var(--accent)_80%,var(--foreground))]',
    word: 'text-muted-foreground font-medium',
  },
  idle: { circle: 'bg-muted text-muted-foreground', word: 'text-muted-foreground font-medium' },
  unknown: { circle: 'bg-muted text-muted-foreground', word: 'text-muted-foreground font-medium' },
} satisfies Record<AgentStatus, { circle: string; word: string }>

const STATUS_GLYPH_ICON = {
  blocked: <HandGlyph className="size-[13px] -translate-y-px" />,
  working: (
    <LoaderCircle
      strokeWidth={2.6}
      className="size-3 animate-spin [animation-duration:1.4s] motion-reduce:animate-none"
    />
  ),
  done: <Check strokeWidth={2.6} className="size-3" />,
  idle: <Pause strokeWidth={2.6} className="size-3" />,
  unknown: <CircleQuestionMark strokeWidth={2.6} className="size-3" />,
} satisfies Record<AgentStatus, React.ReactNode>

function HandGlyph(props: LucideProps) {
  return (
    <svg viewBox="4.5 3.5 16.3 20.5" fill="currentColor" {...props}>
      <rect x="4.5" y="8" width="3.4" height="9" rx="1.7" />
      <rect x="8.8" y="3.5" width="3.4" height="13.5" rx="1.7" />
      <rect x="13.1" y="4.5" width="3.4" height="12.5" rx="1.7" />
      <rect x="17.4" y="8" width="3.4" height="9" rx="1.7" />
      <path d="M4.5 14.5h16.3v2.3a7.2 7.2 0 0 1-7.2 7.2h-1.9a7.2 7.2 0 0 1-7.2-7.2z" />
    </svg>
  )
}

export function StatusGlyph({ status, className }: { status: AgentStatus; className?: string }) {
  const tone = STATUS_GLYPH_TONE[status]

  return (
    <span
      data-slot="status-glyph"
      data-status={status}
      className={cn(
        'inline-flex shrink-0 items-center gap-[7px] text-[13px] leading-[18px] whitespace-nowrap',
        tone.word,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex size-[22px] shrink-0 items-center justify-center rounded-full leading-none',
          tone.circle,
        )}
      >
        {STATUS_GLYPH_ICON[status]}
      </span>
      <Swap id={status}>{STATUS_WORD[status]}</Swap>
    </span>
  )
}
