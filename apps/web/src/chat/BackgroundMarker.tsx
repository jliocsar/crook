import { cn } from 'cn'
import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as React from 'react'

import { BackgroundContext, type BackgroundHandle, KIND_ICON } from '@crook/web/chat/BackgroundDock'
import {
  type BackgroundJob,
  jobStateWord,
  type JobState,
  lastSeen,
  ranFor,
} from '@crook/web/chat/BackgroundModel'
import type { ToolCallModel } from '@crook/web/chat/ChatItems'
import { Swap } from '@crook/web/components/Swap'
import { ChevronColumn, TOOL_ICON_SIZE, TOOL_ROW_CLASS } from '@crook/web/components/ui/tool-call'
import { useNow } from '@crook/web/time/Now'

const MONITOR_TOOL = 'Monitor'
const BASH_TOOL = 'Bash'

export const JOB_DOT = {
  running: 'bg-primary animate-pulse motion-reduce:animate-none',
  done: 'bg-accent',
  failed: 'bg-destructive',
  stopped: 'bg-muted-foreground/50',
  unconfirmed: 'border-muted-foreground/60 border border-dashed',
} satisfies Record<JobState, string>

const canRunInBackground = (call: ToolCallModel): boolean =>
  call.name === MONITOR_TOOL || call.name === BASH_TOOL

const settledText = (job: BackgroundJob, now: DateTime.Utc): string =>
  job.state === 'unconfirmed'
    ? `${job.title} · ${lastSeen(job, now)}`
    : pipe(
        [
          Option.some(job.title),
          job.kind === 'monitor' ? Option.some(`${job.events.length} events`) : Option.none(),
          Option.map(ranFor(job, now), (ran) => `ran ${ran}`),
          Option.some(jobStateWord(job.state)),
        ],
        Arr.getSomes,
        Arr.join(' · '),
      )

const jobOf = (
  work: BackgroundHandle,
  key: string,
  now: DateTime.Utc,
): Option.Option<BackgroundJob> => Arr.findFirst(work.jobsAt(now), (job) => job.key === key)

export const useBackgroundMarker = (call: ToolCallModel): Option.Option<React.ReactNode> => {
  const work = React.useContext(BackgroundContext)

  return pipe(
    Option.liftPredicate(call, canRunInBackground),
    Option.flatMap(() => work),
    Option.filter((found) => HashSet.has(found.keys, call.id)),
    Option.map((found) => <Marker callId={call.id} work={found} />),
  )
}

function Marker({ callId, work }: { callId: string; work: BackgroundHandle }) {
  const [ticking, setTicking] = React.useState(true)
  const now = useNow(ticking)

  return Option.match(jobOf(work, callId, now), {
    onNone: () => null,
    onSome: (job) => {
      const changing = job.state === 'running' || job.state === 'unconfirmed'

      if (changing !== ticking) {
        setTicking(changing)
      }

      return <MarkerButton job={job} now={now} onOpen={work.open} />
    },
  })
}

function MarkerButton({
  job,
  now,
  onOpen,
}: {
  job: BackgroundJob
  now: DateTime.Utc
  onOpen: (job: BackgroundJob) => void
}) {
  const Icon = KIND_ICON[job.kind]
  const live = job.state === 'running'

  return (
    <button
      type="button"
      data-slot="background-marker"
      data-state={job.state}
      onClick={() => {
        onOpen(job)
      }}
      className={cn(
        TOOL_ROW_CLASS,
        'rounded-[var(--radius)] border text-sm',
        live ? 'border-border bg-card' : 'bg-muted/40 border-transparent',
        job.state === 'unconfirmed' && 'border-border border-dashed bg-transparent',
      )}
    >
      <Icon aria-hidden="true" size={TOOL_ICON_SIZE} className="text-muted-foreground shrink-0" />
      <Swap id={live ? 'live' : 'settled'} className="min-w-0 flex-1">
        {live ? (
          <span className="truncate">
            {job.kind === 'monitor' ? 'Watching ' : 'Started '}
            <span className={cn(job.kind === 'shell' && 'font-mono text-[13px]')}>{job.title}</span>
            <span className="text-muted-foreground"> · live below</span>
          </span>
        ) : (
          <span className={cn('truncate', job.kind === 'shell' && 'font-mono text-[13px]')}>
            {settledText(job, now)}
          </span>
        )}
      </Swap>
      <ChevronColumn>
        <span
          aria-hidden="true"
          className={cn('inline-block size-2 shrink-0 rounded-full', JOB_DOT[job.state])}
        />
      </ChevronColumn>
    </button>
  )
}
