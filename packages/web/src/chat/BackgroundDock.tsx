import { cn } from 'cn'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'
import {
  Activity,
  Bot,
  Check,
  ChevronUp,
  CircleDashed,
  type LucideIcon,
  Square,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import * as React from 'react'

import type { ChatItem } from '@crook/web/chat/ChatItems'
import { runsIn } from '@crook/web/chat/ChatItems'
import { backgroundsOf, linesOf, type TranscriptView } from '@crook/web/chat/TranscriptState'

import {
  type BackgroundDock as Dock,
  backgroundJobs,
  type BackgroundJob,
  dockOf,
  isRoomy,
  isShown,
  jobStateWord,
  type JobKind,
  type JobState,
  lastSeen,
  ranFor,
} from '@crook/web/chat/BackgroundModel'
import { BackgroundSheet } from '@crook/web/chat/BackgroundSheet'
import { Collapse } from '@crook/web/components/Collapse'
import { Swap } from '@crook/web/components/Swap'
import { Spinner } from '@crook/web/components/ui/spinner'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { INSTANT, SPRING } from '@crook/web/motion/Springs'
import { useTransformString } from '@crook/web/motion/TransformString'
import { clockElapsed, shortElapsed } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

const CHIP_POP_FROM = 0.85
const EVENT_TRAVEL = 8
const FINISHED_CHIP_OPACITY = 0.75
const EDGE_SLACK = 2
const SHELL_TAIL_LINES = 2
const PERCENT = 100
const SHORTEST_TICK_SPAN = Duration.seconds(20)

export const KIND_ICON = {
  subagent: Bot,
  shell: SquareTerminal,
  monitor: Activity,
} satisfies Record<JobKind, LucideIcon>

export const HIT_AREA =
  "relative touch-manipulation after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"

const TINT = {
  running: 'bg-primary/[0.07] border-primary/30 text-foreground dark:bg-primary/12',
  failed:
    'bg-destructive/14 border-destructive/70 text-destructive dark:bg-destructive/25 dark:text-[color-mix(in_oklab,var(--destructive)_70%,white)]',
  done: 'bg-accent/22 border-accent/55 text-foreground dark:bg-accent/14',
  stopped: 'bg-muted border-border text-muted-foreground',
  unconfirmed: 'border-muted-foreground/55 text-muted-foreground border-dashed bg-transparent',
} satisfies Record<JobState, string>

const chipTime = (job: BackgroundJob, now: DateTime.Utc): string =>
  job.state === 'unconfirmed'
    ? Option.match(job.lastSeenAt, {
        onNone: () => '',
        onSome: (seen) => `${shortElapsed(now, seen)} ago`,
      })
    : Option.getOrElse(ranFor(job, now), () => '')

const dockSpan = (dock: Dock, now: DateTime.Utc): string =>
  Option.match(dock.since, {
    onNone: () => '',
    onSome: (since) =>
      clockElapsed(
        Option.getOrElse(dock.until, () => now),
        since,
      ),
  })

const isLive = (job: BackgroundJob): boolean => job.state === 'running'

const hasRunningJob = (jobs: readonly BackgroundJob[]): boolean => Arr.some(jobs, isLive)

const useChipMotion = () => {
  const reduce = useReducedMotion() ?? false
  const transform = useTransformString()

  return {
    layout: reduce ? false : ('position' as const),
    initial: { opacity: 0, transform: transform.scale(CHIP_POP_FROM) },
    exit: {
      opacity: 0,
      transform: transform.scale(CHIP_POP_FROM),
      transition: motionTokens().fade,
    },
    transition: reduce
      ? { ...INSTANT, opacity: motionTokens().fade }
      : { ...SPRING, opacity: motionTokens().fade },
  }
}

const useOverflowEdges = <Element extends HTMLElement>() => {
  const ref = React.useRef<Element>(null)
  const [edges, setEdges] = React.useState({ start: false, end: false })

  React.useLayoutEffect(() => {
    const element = ref.current

    if (element === null) {
      return undefined
    }

    const measure = () => {
      const start = element.scrollLeft > EDGE_SLACK
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - EDGE_SLACK

      setEdges((was) => (was.start === start && was.end === end ? was : { start, end }))
    }

    const resized = new ResizeObserver(measure)

    const observeChildren = () => {
      Arr.forEach(Array.from(element.children), (child) => {
        resized.observe(child)
      })
    }

    const mutated = new MutationObserver(() => {
      observeChildren()
      measure()
    })

    measure()
    resized.observe(element)
    observeChildren()
    mutated.observe(element, { childList: true })
    element.addEventListener('scroll', measure, { passive: true })

    return () => {
      resized.disconnect()
      mutated.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [])

  const mask = `linear-gradient(to right, ${edges.start ? 'transparent 0, black 28px' : 'black 0'}, ${edges.end ? 'black calc(100% - 40px), transparent 100%' : 'black 100%'})`

  return { ref, edges, style: { maskImage: mask, WebkitMaskImage: mask } }
}

export const useSessionJobs = (
  view: Option.Option<TranscriptView>,
  items: readonly ChatItem[],
): ((now: DateTime.Utc) => readonly BackgroundJob[]) => {
  const session = Option.getOrUndefined(Option.map(Arr.last(linesOf(view)), (line) => line.session))
  const background = Option.getOrUndefined(
    Option.flatMap(Option.fromUndefinedOr(session), (current) =>
      HashMap.get(backgroundsOf(view), current),
    ),
  )
  const runs = React.useMemo(
    () => Arr.filter(runsIn(items), (run) => run.session === session),
    [items, session],
  )

  return React.useCallback(
    (now: DateTime.Utc) =>
      backgroundJobs({ background: Option.fromUndefinedOr(background), runs, now }),
    [background, runs],
  )
}

export function JobGlyph({ job, size = 12 }: { job: BackgroundJob; size?: number }) {
  const Icon = KIND_ICON[job.kind]

  if (job.state === 'failed') {
    return <TriangleAlert aria-hidden="true" size={size} strokeWidth={2.4} />
  }

  if (job.state === 'done') {
    return (
      <Check
        aria-hidden="true"
        size={size}
        strokeWidth={3}
        className="text-accent-foreground dark:text-accent"
      />
    )
  }

  if (job.state === 'stopped') {
    return <Square aria-hidden="true" size={size - 3} fill="currentColor" />
  }

  if (job.state === 'unconfirmed') {
    return <CircleDashed aria-hidden="true" size={size} />
  }

  return <Icon aria-hidden="true" size={size} strokeWidth={2.2} className="text-primary" />
}

export function JobStateIcon({ state, size = 13 }: { state: JobState; size?: number }) {
  if (state === 'running') {
    return <Spinner size={size} className="text-primary" />
  }

  if (state === 'done') {
    return <Check aria-hidden="true" size={size} strokeWidth={2.5} className="text-accent" />
  }

  if (state === 'failed') {
    return <TriangleAlert aria-hidden="true" size={size} className="text-destructive" />
  }

  if (state === 'stopped') {
    return (
      <Square
        aria-hidden="true"
        size={size - 3}
        fill="currentColor"
        className="text-muted-foreground"
      />
    )
  }

  return <CircleDashed aria-hidden="true" size={size} className="text-muted-foreground" />
}

function Capsule({
  job,
  roomy,
  now,
  onOpen,
}: {
  job: BackgroundJob
  roomy: boolean
  now: DateTime.Utc
  onOpen: (job: BackgroundJob) => void
}) {
  const chipMotion = useChipMotion()
  const finished = job.state !== 'running' && job.state !== 'unconfirmed'
  const label = roomy ? job.title : job.shortLabel

  return (
    <motion.button
      type="button"
      data-slot="background-chip"
      data-state={job.state}
      aria-label={`${job.title}, ${jobStateWord(job.state)}`}
      layout={chipMotion.layout}
      initial={chipMotion.initial}
      animate={{
        opacity: finished && job.state !== 'failed' ? FINISHED_CHIP_OPACITY : 1,
        transform: 'scale(1)',
      }}
      exit={chipMotion.exit}
      transition={chipMotion.transition}
      onClick={() => {
        onOpen(job)
      }}
      className={cn(
        HIT_AREA,
        'flex h-7 max-w-[60vw] shrink-0 snap-start items-center gap-1 rounded-full border ps-2 pe-2.5 text-xs transition-colors duration-[180ms] ease-out',
        TINT[job.state],
      )}
    >
      <JobGlyph job={job} />
      <span
        className={cn(
          'ms-0.5 truncate font-semibold whitespace-nowrap',
          job.kind === 'shell' && 'font-mono text-[11.5px] font-medium',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'font-mono text-[11px] whitespace-nowrap tabular-nums',
          job.state === 'failed' ? 'text-destructive/80' : 'text-muted-foreground',
        )}
      >
        {chipTime(job, now)}
      </span>
    </motion.button>
  )
}

function ChipRow({
  chips,
  now,
  onOpen,
}: {
  chips: readonly BackgroundJob[]
  now: DateTime.Utc
  onOpen: (job: BackgroundJob) => void
}) {
  const overflow = useOverflowEdges<HTMLDivElement>()
  const roomy = isRoomy(chips)

  return (
    <div
      ref={overflow.ref}
      style={overflow.style}
      data-slot="background-chips"
      className="no-scrollbar mt-1.5 flex snap-x scroll-px-4 gap-1.5 overflow-x-auto px-4 py-0.5"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {chips.map((job) => (
          <Capsule key={job.key} job={job} roomy={roomy} now={now} onOpen={onOpen} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function EventLine({ dock }: { dock: Dock }) {
  const transform = useTransformString()

  return Option.match(dock.latest, {
    onNone: () => null,
    onSome: (latest) => (
      <span
        data-slot="background-event"
        className="text-muted-foreground mt-1.5 flex items-center gap-1.5 px-4 font-mono text-[11px]"
      >
        <span className="text-foreground/80 shrink-0">{latest.label}</span>
        <span aria-hidden="true">›</span>
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={`${latest.key}-${DateTime.toEpochMillis(latest.event.at)}`}
            className={cn('min-w-0 truncate', latest.event.tone === 'bad' && 'text-destructive')}
            initial={{ opacity: 0, transform: transform.translate('X', EVENT_TRAVEL) }}
            animate={{ opacity: 1, transform: 'translateX(0px)' }}
            exit={{ opacity: 0 }}
            transition={motionTokens().fade}
          >
            {latest.event.text}
          </motion.span>
        </AnimatePresence>
      </span>
    ),
  })
}

export function OutputTail({
  lines,
  max,
  className,
}: {
  lines: readonly string[]
  max: number
  className?: string
}) {
  const shown = Arr.takeRight(lines, max)

  return (
    <span
      data-slot="output-tail"
      className={cn(
        'text-muted-foreground block font-mono text-[11px] leading-4 [mask-image:linear-gradient(to_bottom,transparent_0,black_70%)]',
        className,
      )}
    >
      {shown.map((line, index) => (
        <span
          key={`${index}-${line}`}
          className={cn(
            'block truncate whitespace-pre',
            index === shown.length - 1 && 'text-foreground/85',
          )}
        >
          {line}
        </span>
      ))}
    </span>
  )
}

function MonitorTicks({ job, now }: { job: BackgroundJob; now: DateTime.Utc }) {
  const transform = useTransformString()
  const reduce = useReducedMotion() ?? false
  const end = Option.getOrElse(job.endedAt, () => now)
  const start = Option.getOrElse(job.startedAt, () => end)
  const span = Math.max(
    DateTime.toEpochMillis(end) - DateTime.toEpochMillis(start),
    Duration.toMillis(SHORTEST_TICK_SPAN),
  )

  return (
    <span aria-hidden="true" data-slot="monitor-ticks" className="relative mt-1 block h-3">
      <span className="bg-border absolute inset-x-0 top-1/2 h-px -translate-y-1/2" />
      {isLive(job) ? (
        <span className="bg-primary/50 absolute top-1/2 right-0 h-px w-6 -translate-y-1/2 animate-pulse motion-reduce:animate-none" />
      ) : null}
      {job.events.map((event) => (
        <motion.span
          key={`${DateTime.toEpochMillis(event.at)}-${event.text}`}
          className={cn(
            'absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--background)]',
            event.tone === 'bad' ? 'bg-destructive' : 'bg-muted-foreground/50',
          )}
          style={{
            left: `${((DateTime.toEpochMillis(event.at) - DateTime.toEpochMillis(start)) / span) * PERCENT}%`,
          }}
          initial={{ transform: transform.scale(0) }}
          animate={{ transform: 'scale(1)' }}
          transition={reduce ? INSTANT : SPRING}
        />
      ))}
    </span>
  )
}

function DockRow({
  job,
  now,
  onOpen,
}: {
  job: BackgroundJob
  now: DateTime.Utc
  onOpen: (job: BackgroundJob) => void
}) {
  const Icon = KIND_ICON[job.kind]

  if (job.state === 'unconfirmed') {
    return (
      <li>
        <button
          type="button"
          data-slot="background-row"
          onClick={() => {
            onOpen(job)
          }}
          className="text-muted-foreground flex min-h-11 w-full items-center gap-2.5 px-4 text-left text-xs"
        >
          <CircleDashed aria-hidden="true" size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            <span className={cn(job.kind === 'shell' && 'font-mono')}>{job.title}</span>
            {" · can't confirm it's running"}
          </span>
          <span className="shrink-0 font-mono text-[11px]">{lastSeen(job, now)}</span>
        </button>
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        data-slot="background-row"
        onClick={() => {
          onOpen(job)
        }}
        className="flex min-h-11 w-full items-start gap-2.5 px-4 py-2 text-left"
      >
        <span className="flex h-5 shrink-0 items-center">
          <Icon aria-hidden="true" size={14} className="text-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex h-5 items-center gap-1.5">
            <span
              className={cn('truncate text-sm', job.kind === 'shell' && 'font-mono text-[13px]')}
            >
              {job.kind === 'monitor' ? `Watching ${job.title}` : job.title}
            </span>
            {job.kind === 'subagent' && job.background ? (
              <span className="border-border text-muted-foreground shrink-0 rounded border px-1 font-mono text-[10px] leading-4">
                bg
              </span>
            ) : null}
            {job.kind === 'subagent' && !job.background && isLive(job) ? (
              <span className="text-primary shrink-0 text-[11px] font-semibold">
                Claude waits on it
              </span>
            ) : null}
          </span>
          {job.kind === 'monitor' ? <MonitorTicks job={job} now={now} /> : null}
          {job.kind === 'shell' && isLive(job) ? (
            <OutputTail lines={job.output} max={SHELL_TAIL_LINES} className="mt-0.5" />
          ) : (
            pipe(
              isLive(job) ? job.doing : Option.orElse(job.result, () => job.doing),
              Option.match({
                onNone: () => null,
                onSome: (text) => (
                  <span
                    className={cn(
                      'block truncate font-mono text-[11px]',
                      job.state === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {text}
                  </span>
                ),
              }),
            )
          )}
        </span>
        <span className="flex h-5 shrink-0 items-center gap-2">
          <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
            {Option.getOrElse(ranFor(job, now), () => '')}
          </span>
          <JobStateIcon state={job.state} />
        </span>
      </button>
    </li>
  )
}

function DockTray({
  dock,
  now,
  onOpen,
}: {
  dock: Dock
  now: DateTime.Utc
  onOpen: (job: BackgroundJob) => void
}) {
  const [expanded, setExpanded] = React.useState(false)
  const headline = dock.settling ? 'All background work finished' : `${dock.running} running`

  return (
    <div data-slot="background-dock" className="border-border bg-background border-t pt-2 pb-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${headline}, ${expanded ? 'hide' : 'show'} details`}
        onClick={() => {
          setExpanded((open) => !open)
        }}
        className={cn(HIT_AREA, 'flex w-full items-center gap-2 px-4 text-left')}
      >
        <Swap id={dock.settling ? 'settled' : 'live'} className="text-xs font-semibold">
          {headline}
        </Swap>
        <span className="text-muted-foreground ms-auto font-mono text-[11px] tabular-nums">
          {dockSpan(dock, now)}
        </span>
        <ChevronUp
          aria-hidden="true"
          size={16}
          className={cn(
            'text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
            expanded && 'rotate-180',
          )}
        />
      </button>
      <ChipRow chips={dock.chips} now={now} onOpen={onOpen} />
      {expanded ? null : <EventLine dock={dock} />}
      <Collapse open={expanded}>
        <ul className="divide-border no-scrollbar mt-1.5 max-h-[46dvh] divide-y overflow-y-auto">
          {dock.rows.map((job) => (
            <DockRow key={job.key} job={job} now={now} onOpen={onOpen} />
          ))}
        </ul>
      </Collapse>
    </div>
  )
}

export function BackgroundDock({
  jobsAt,
  onOpenSubagent,
}: {
  jobsAt: (now: DateTime.Utc) => readonly BackgroundJob[]
  onOpenSubagent: (job: BackgroundJob) => void
}) {
  const [ticking, setTicking] = React.useState(true)
  const [openKey, setOpenKey] = React.useState(Option.none<string>())
  const now = useNow(ticking)
  const jobs = React.useMemo(() => jobsAt(now), [jobsAt, now])
  const dock = dockOf(jobs, now)
  const shown = isShown(dock)
  const needsClock = shown || hasRunningJob(jobs) || Option.isSome(openKey)
  const reduce = useReducedMotion() ?? false
  const openJob = Option.flatMap(openKey, (key) => Arr.findFirst(jobs, (job) => job.key === key))
  const onOpen = React.useCallback(
    (job: BackgroundJob) => {
      if (job.kind === 'subagent') {
        onOpenSubagent(job)
      } else {
        setOpenKey(Option.some(job.key))
      }
    },
    [onOpenSubagent],
  )

  if (needsClock !== ticking) {
    setTicking(needsClock)
  }

  return (
    <>
      <AnimatePresence initial={false}>
        {shown ? (
          <motion.div
            key="dock"
            className="shrink-0 overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduce ? INSTANT : SPRING}
          >
            <DockTray dock={dock} now={now} onOpen={onOpen} />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <BackgroundSheet
        job={openJob}
        now={now}
        onClose={() => {
          setOpenKey(Option.none())
        }}
      />
    </>
  )
}
