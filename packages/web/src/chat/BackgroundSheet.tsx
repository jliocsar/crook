import { cn } from 'cn'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as React from 'react'

import { type BackgroundJob, jobStateWord, lastSeen, ranFor } from '@crook/web/chat/BackgroundModel'
import { Sheet } from '@crook/web/components/Sheet'
import { Spinner } from '@crook/web/components/ui/spinner'

const TIME_OF_DAY = { hour: '2-digit', minute: '2-digit' } as const

const timeOfDay = (at: DateTime.Utc): string => DateTime.formatLocal(at, TIME_OF_DAY)

const jobTitle = (job: BackgroundJob): string =>
  job.kind === 'monitor' ? `Watching ${job.title}` : job.title

const jobMeta = (job: BackgroundJob, now: DateTime.Utc): string =>
  pipe(
    [
      Option.some(jobStateWord(job.state)),
      job.state === 'unconfirmed' ? Option.some(lastSeen(job, now)) : ranFor(job, now),
      Option.some('background'),
      job.detail,
    ],
    Arr.getSomes,
    Arr.join(' · '),
  )

function SheetLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-muted-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
      {children}
    </h3>
  )
}

function Unconfirmed({ job, now }: { job: BackgroundJob; now: DateTime.Utc }) {
  return (
    <p
      data-slot="background-unconfirmed"
      className="border-border bg-muted/40 text-muted-foreground rounded-[var(--radius)] border border-dashed p-3 text-sm leading-5"
    >
      {`crook can't tell whether this is still running. It was ${lastSeen(job, now)}, and nothing has said it ended.`}
    </p>
  )
}

function ShellDetail({ job, now }: { job: BackgroundJob; now: DateTime.Utc }) {
  const live = job.state === 'running'

  return (
    <div className="grid gap-4 pb-2">
      {job.state === 'unconfirmed' ? <Unconfirmed job={job} now={now} /> : null}
      <div>
        <SheetLabel>Output</SheetLabel>
        <div className="bg-muted/50 border-border max-h-56 overflow-y-auto rounded-[var(--radius)] border p-3 font-mono text-xs leading-5">
          {job.output.length === 0 ? (
            <span className="text-muted-foreground">Nothing printed yet</span>
          ) : (
            job.output.map((line, index) => (
              <div key={`${index}-${line}`} className="truncate whitespace-pre">
                {line}
              </div>
            ))
          )}
          {live ? (
            <span
              aria-hidden="true"
              className="bg-foreground/70 inline-block h-3.5 w-1.5 animate-pulse align-middle motion-reduce:animate-none"
            />
          ) : null}
        </div>
      </div>
      <div>
        <SheetLabel>Claude</SheetLabel>
        <ul className="text-muted-foreground grid gap-1 text-sm">
          <li>Started it in the background</li>
          {job.checkedAt.map((at) => (
            <li key={DateTime.toEpochMillis(at)}>{`Read its output at ${timeOfDay(at)}`}</li>
          ))}
          {job.stoppedByClaude ? <li>Stopped it</li> : null}
          {Option.match(job.result, {
            onNone: () => null,
            onSome: (result) => (
              <li className={cn(job.state === 'failed' && 'text-destructive')}>{result}</li>
            ),
          })}
        </ul>
      </div>
    </div>
  )
}

function MonitorDetail({ job, now }: { job: BackgroundJob; now: DateTime.Utc }) {
  const live = job.state === 'running'

  return (
    <div className="grid gap-4 pb-2">
      {job.state === 'unconfirmed' ? <Unconfirmed job={job} now={now} /> : null}
      <div>
        <SheetLabel>Events</SheetLabel>
        <ul className="grid gap-1.5 text-sm">
          {job.events.map((event) => (
            <li
              key={`${DateTime.toEpochMillis(event.at)}-${event.text}`}
              className="flex items-baseline gap-2.5"
            >
              <span className="text-muted-foreground w-12 shrink-0 font-mono text-xs tabular-nums">
                {timeOfDay(event.at)}
              </span>
              <span className={cn('min-w-0', event.tone === 'bad' && 'text-destructive')}>
                {event.text}
              </span>
            </li>
          ))}
        </ul>
        {live ? (
          <p className="text-muted-foreground mt-1.5 flex items-center gap-2.5 text-sm">
            <span className="w-12" />
            <Spinner size={12} className="text-primary" />
            <span className="font-mono text-xs">watching</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function BackgroundSheet({
  job,
  now,
  onClose,
}: {
  job: Option.Option<BackgroundJob>
  now: DateTime.Utc
  onClose: () => void
}) {
  const [last, setLast] = React.useState(job)

  if (Option.isSome(job) && !Option.exists(last, (kept) => kept === job.value)) {
    setLast(job)
  }

  const shown = Option.orElse(job, () => last)

  return (
    <Sheet
      open={Option.isSome(job)}
      onClose={onClose}
      title={Option.match(shown, { onNone: () => '', onSome: jobTitle })}
      description={Option.match(shown, {
        onNone: () => null,
        onSome: (found) => <span className="font-mono text-xs">{jobMeta(found, now)}</span>,
      })}
    >
      {Option.match(shown, {
        onNone: () => null,
        onSome: (found) =>
          found.kind === 'monitor' ? (
            <MonitorDetail job={found} now={now} />
          ) : (
            <ShellDetail job={found} now={now} />
          ),
      })}
    </Sheet>
  )
}
