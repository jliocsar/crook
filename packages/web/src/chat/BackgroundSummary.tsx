import { cn } from 'cn'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as React from 'react'

import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import { JOB_DOT } from '@crook/web/chat/BackgroundMarker'
import {
  type BackgroundJob,
  type EpisodeSummary,
  settledEpisode,
  summaryDueAt,
} from '@crook/web/chat/BackgroundModel'
import type { BackgroundHandle } from '@crook/web/chat/BackgroundDock'
import type { ThreadRow } from '@crook/web/chat/Thread'
import type { TranscriptLine } from '@crook/web/chat/TranscriptState'
import { clockElapsed } from '@crook/web/time/Elapsed'

const SUMMARY_KEY = 'background-summary'

const promptTimeOf = (message: TranscriptMessage): Option.Option<DateTime.Utc> =>
  Match.value(message).pipe(
    Match.tag('User', (user) =>
      !user.isMeta &&
      Arr.some(user.blocks, (block) =>
        Match.value(block).pipe(
          Match.tag('Text', () => true),
          Match.orElse(() => false),
        ),
      )
        ? user.timestamp
        : Option.none(),
    ),
    Match.orElse(() => Option.none()),
  )

const lineMessage = (line: TranscriptLine): Option.Option<TranscriptMessage> =>
  Match.value(line).pipe(
    Match.tag('Message', (found) => Option.some(found.message)),
    Match.orElse(() => Option.none()),
  )

const lastPromptAt = (lines: readonly TranscriptLine[]): Option.Option<DateTime.Utc> =>
  pipe(
    Arr.findLast(lines, (line) => Option.isSome(Option.flatMap(lineMessage(line), promptTimeOf))),
    Option.flatMap(lineMessage),
    Option.flatMap(promptTimeOf),
  )

const signatureOf = (summary: Option.Option<EpisodeSummary>): string =>
  Option.match(summary, {
    onNone: () => '',
    onSome: (found) => {
      const parts = Arr.map(found.parts, (part) => `${part.state}:${part.text}`)

      return Arr.join(
        [
          found.focus.key,
          String(DateTime.toEpochMillis(found.since)),
          String(DateTime.toEpochMillis(found.until)),
          ...parts,
        ],
        '|',
      )
    },
  })

const useWakeAt = (at: Option.Option<DateTime.Utc>, now: DateTime.Utc): void => {
  const [, wake] = React.useReducer((count: number) => count + 1, 0)
  const delay = Option.getOrUndefined(
    Option.map(
      Option.filter(at, (moment) => DateTime.isGreaterThan(moment, now)),
      (moment) => DateTime.toEpochMillis(moment) - DateTime.toEpochMillis(now),
    ),
  )

  React.useEffect(() => {
    if (delay === undefined) {
      return undefined
    }

    const timer = window.setTimeout(wake, delay)

    return () => {
      window.clearTimeout(timer)
    }
  }, [delay])
}

export const useEpisodeSummary = (
  work: BackgroundHandle,
  lines: readonly TranscriptLine[],
): Option.Option<EpisodeSummary> => {
  const now = DateTime.nowUnsafe()
  const jobs = work.jobsAt(now)
  const promptedAt = React.useMemo(() => lastPromptAt(lines), [lines])
  const summary = settledEpisode({ jobs, now, promptedAt })
  const [kept, keep] = React.useState(summary)

  useWakeAt(summaryDueAt(jobs), now)

  if (signatureOf(kept) !== signatureOf(summary)) {
    keep(summary)

    return summary
  }

  return kept
}

export const summaryRows = (
  summary: Option.Option<EpisodeSummary>,
  onOpen: (job: BackgroundJob) => void,
): readonly ThreadRow[] =>
  Option.match(summary, {
    onNone: () => [],
    onSome: (found) => [
      { key: SUMMARY_KEY, content: <BackgroundSummaryRow summary={found} onOpen={onOpen} /> },
    ],
  })

function BackgroundSummaryRow({
  summary,
  onOpen,
}: {
  summary: EpisodeSummary
  onOpen: (job: BackgroundJob) => void
}) {
  return (
    <button
      type="button"
      data-slot="background-summary"
      onClick={() => {
        onOpen(summary.focus)
      }}
      className="border-border bg-muted/40 flex min-h-11 w-full items-center gap-3 rounded-[var(--radius)] border px-3.5 py-2 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-xs">
          <span className="font-semibold">Background work finished</span>
          <span className="text-muted-foreground ms-auto font-mono text-[11px] tabular-nums">
            {clockElapsed(summary.until, summary.since)}
          </span>
        </span>
        <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          {summary.parts.map((part) => (
            <span
              key={part.text}
              className={cn(
                'flex items-center gap-1.5',
                part.state === 'failed' && 'text-destructive',
              )}
            >
              <span
                aria-hidden="true"
                className={cn('inline-block size-1.5 shrink-0 rounded-full', JOB_DOT[part.state])}
              />
              {part.text}
            </span>
          ))}
        </span>
      </span>
    </button>
  )
}
