import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'

import type {
  BackgroundTask,
  MonitorTask,
  ShellTask,
  SubagentActivity,
} from '@crook/domain/Background'
import type { SubagentId } from '@crook/domain/Ids'
import type { SubagentStatus } from '@crook/domain/Subagent'
import type { BackgroundChanged } from '@crook/domain/Transcript'
import { firstLine } from '@crook/domain/ToolSubject'
import { clockElapsed, shortElapsed } from '@crook/web/time/Elapsed'

export type JobKind = 'subagent' | 'shell' | 'monitor'

export type JobState = 'running' | 'done' | 'failed' | 'stopped' | 'unconfirmed'

export type EventTone = 'plain' | 'bad'

export interface DockRun {
  readonly toolUseId: string
  readonly subagent: Option.Option<SubagentId>
  readonly description: string
  readonly agentType: string
  readonly model: Option.Option<string>
  readonly background: boolean
  readonly status: 'running' | 'done' | 'failed'
  readonly unconfirmed: boolean
  readonly startedAt: Option.Option<DateTime.Utc>
  readonly finishedAt: Option.Option<DateTime.Utc>
}

interface Span {
  readonly job: BackgroundJob
  readonly start: DateTime.Utc
  readonly end: DateTime.Utc
}

const DONE_HOLD = Duration.seconds(7)
const SETTLE_HOLD = Duration.seconds(14)
const ROOMY_CHIPS = 2
const COMMAND_SEPARATOR = /\s*(?:&&|\|\||;|\|)\s*/u
const WHITESPACE = /\s+/u
const CHANGE_DIRECTORY = /^cd(?:\s|$)/u

export class JobEvent extends Data.Class<{
  readonly at: DateTime.Utc
  readonly text: string
  readonly tone: EventTone
}> {}

export class BackgroundJob extends Data.Class<{
  readonly key: string
  readonly kind: JobKind
  readonly title: string
  readonly shortLabel: string
  readonly state: JobState
  readonly startedAt: Option.Option<DateTime.Utc>
  readonly endedAt: Option.Option<DateTime.Utc>
  readonly lastSeenAt: Option.Option<DateTime.Utc>
  readonly doing: Option.Option<string>
  readonly output: readonly string[]
  readonly events: readonly JobEvent[]
  readonly result: Option.Option<string>
  readonly subagent: Option.Option<SubagentId>
  readonly background: boolean
  readonly detail: Option.Option<string>
  readonly checkedAt: readonly DateTime.Utc[]
  readonly stoppedByClaude: boolean
}> {}

export class DockEvent extends Data.Class<{
  readonly key: string
  readonly label: string
  readonly event: JobEvent
}> {}

export class SummaryPart extends Data.Class<{
  readonly text: string
  readonly state: JobState
}> {}

export class EpisodeSummary extends Data.Class<{
  readonly since: DateTime.Utc
  readonly until: DateTime.Utc
  readonly parts: readonly SummaryPart[]
  readonly focus: BackgroundJob
}> {}

export class DockModel extends Data.Class<{
  readonly chips: readonly BackgroundJob[]
  readonly rows: readonly BackgroundJob[]
  readonly running: number
  readonly settling: boolean
  readonly since: Option.Option<DateTime.Utc>
  readonly until: Option.Option<DateTime.Utc>
  readonly latest: Option.Option<DockEvent>
}> {}

const firstWord = (text: string): string =>
  pipe(
    text.trim().split(WHITESPACE),
    Arr.head,
    Option.filter((word) => word.length > 0),
    Option.getOrElse(() => text),
  )

const lastWord = (text: string): string =>
  pipe(
    text.trim().split(WHITESPACE),
    Arr.last,
    Option.filter((word) => word.length > 0),
    Option.getOrElse(() => text),
  )

export const commandLabel = (command: string): string =>
  pipe(
    firstLine(command).split(COMMAND_SEPARATOR),
    Arr.findFirst((segment) => segment.length > 0 && !CHANGE_DIRECTORY.test(segment)),
    Option.map(lastWord),
    Option.getOrElse(() => command),
  )

const withinHold = (moment: DateTime.Utc, now: DateTime.Utc, hold: Duration.Duration): boolean =>
  DateTime.isGreaterThan(DateTime.addDuration(moment, hold), now)

const ofStatus = (status: SubagentStatus): JobState =>
  Match.value(status).pipe(
    Match.when('running', (): JobState => 'running'),
    Match.when('completed', (): JobState => 'done'),
    Match.when('failed', (): JobState => 'failed'),
    Match.when('stopped', (): JobState => 'stopped'),
    Match.exhaustive,
  )

const latestMoment = (
  moments: readonly Option.Option<DateTime.Utc>[],
): Option.Option<DateTime.Utc> =>
  pipe(
    Arr.getSomes(moments),
    Arr.match({
      onEmpty: Option.none,
      onNonEmpty: (all) => Option.some(Arr.max(all, DateTime.Order)),
    }),
  )

const earliestMoment = (
  moments: readonly Option.Option<DateTime.Utc>[],
): Option.Option<DateTime.Utc> =>
  pipe(
    Arr.getSomes(moments),
    Arr.match({
      onEmpty: Option.none,
      onNonEmpty: (all) => Option.some(Arr.min(all, DateTime.Order)),
    }),
  )

const shellState = (shell: ShellTask): JobState =>
  Match.value(ofStatus(shell.status)).pipe(
    Match.when('running', (): JobState =>
      Option.exists(shell.alive, (alive) => !alive) ? 'unconfirmed' : 'running',
    ),
    Match.orElse((state) => state),
  )

const monitorState = (monitor: MonitorTask, now: DateTime.Utc): JobState =>
  Match.value(ofStatus(monitor.status)).pipe(
    Match.when('running', (): JobState =>
      Option.exists(monitor.expiresAt, (expiry) => DateTime.isLessThan(expiry, now))
        ? 'unconfirmed'
        : 'running',
    ),
    Match.orElse((state) => state),
  )

const endEvent = (
  state: JobState,
  endedAt: Option.Option<DateTime.Utc>,
  summary: Option.Option<string>,
): readonly JobEvent[] =>
  pipe(
    endedAt,
    Option.filter(() => state !== 'running' && state !== 'unconfirmed'),
    Option.map(
      (at) =>
        new JobEvent({
          at,
          tone: state === 'failed' ? 'bad' : 'plain',
          text: pipe(
            summary,
            Option.filter(() => state === 'failed'),
            Option.match({ onNone: () => state, onSome: (why) => `failed: ${why}` }),
          ),
        }),
    ),
    Option.toArray,
  )

const shellJob = (shell: ShellTask): BackgroundJob => {
  const command = Option.map(shell.command, firstLine)
  const lastSeenAt = Option.orElse(shell.lastOutputAt, () => shell.startedAt)
  const state = shellState(shell)
  const outputEvent = pipe(
    Option.all({ at: shell.lastOutputAt, text: Arr.last(shell.output) }),
    Option.map(({ at, text }) => new JobEvent({ at, text, tone: 'plain' })),
    Option.toArray,
  )

  return new BackgroundJob({
    key: shell.toolUseId,
    kind: 'shell',
    title: Option.getOrElse(command, () => Option.getOrElse(shell.description, () => shell.taskId)),
    shortLabel: Option.match(command, {
      onNone: () =>
        Option.match(shell.description, { onNone: () => shell.taskId, onSome: firstWord }),
      onSome: commandLabel,
    }),
    state,
    startedAt: shell.startedAt,
    endedAt: shell.endedAt,
    lastSeenAt,
    doing: Arr.last(shell.output),
    output: shell.output,
    events: [...outputEvent, ...endEvent(state, shell.endedAt, shell.summary)],
    result: shell.summary,
    subagent: Option.none(),
    background: true,
    detail: shell.description,
    checkedAt: shell.checkedAt,
    stoppedByClaude: shell.stoppedByClaude,
  })
}

const monitorJob = (monitor: MonitorTask, now: DateTime.Utc): BackgroundJob => {
  const events = Arr.flatMap(monitor.events, (event) =>
    Option.toArray(
      Option.map(event.at, (at) => new JobEvent({ at, text: event.text, tone: 'plain' })),
    ),
  )
  const lastSeenAt = Option.orElse(
    latestMoment(Arr.map(events, (event) => Option.some(event.at))),
    () => monitor.startedAt,
  )
  const state = monitorState(monitor, now)

  return new BackgroundJob({
    key: monitor.toolUseId,
    kind: 'monitor',
    title: monitor.description,
    shortLabel: firstWord(monitor.description),
    state,
    startedAt: monitor.startedAt,
    endedAt: monitor.endedAt,
    lastSeenAt,
    doing: Option.map(Arr.last(events), (event) => event.text),
    output: [],
    events: [...events, ...endEvent(state, monitor.endedAt, monitor.summary)],
    result: monitor.summary,
    subagent: Option.none(),
    background: true,
    detail: monitor.command,
    checkedAt: [],
    stoppedByClaude: monitor.stoppedByClaude,
  })
}

const taskJob = (task: BackgroundTask, now: DateTime.Utc): BackgroundJob =>
  Match.value(task).pipe(
    Match.tagsExhaustive({
      ShellTask: shellJob,
      MonitorTask: (monitor) => monitorJob(monitor, now),
    }),
  )

export const activityText = (activity: SubagentActivity): Option.Option<string> =>
  Option.orElse(
    Option.map(activity.tool, (tool) =>
      Option.match(activity.subject, {
        onNone: () => tool,
        onSome: (subject) => `${tool}(${subject})`,
      }),
    ),
    () => activity.text,
  )

const runJob = (
  run: DockRun,
  activities: HashMap.HashMap<SubagentId, SubagentActivity>,
): BackgroundJob => {
  const activity = Option.flatMap(run.subagent, (id) => HashMap.get(activities, id))
  const doing = Option.flatMap(activity, activityText)
  const state: JobState = run.unconfirmed ? 'unconfirmed' : run.status
  const doingEvent = pipe(
    Option.all({ at: Option.flatMap(activity, (found) => found.at), text: doing }),
    Option.map(({ at, text }) => new JobEvent({ at, text, tone: 'plain' })),
    Option.toArray,
  )

  return new BackgroundJob({
    key: run.toolUseId,
    kind: 'subagent',
    title: run.description,
    shortLabel: firstWord(run.description),
    state,
    startedAt: run.startedAt,
    endedAt: run.finishedAt,
    lastSeenAt: Option.orElse(
      Option.flatMap(activity, (found) => found.at),
      () => run.startedAt,
    ),
    doing,
    output: [],
    events: [...doingEvent, ...endEvent(state, run.finishedAt, Option.none())],
    result: Option.none(),
    subagent: run.subagent,
    background: run.background,
    detail: Option.some(
      pipe([Option.some(run.agentType), run.model], Arr.getSomes, Arr.join(' · ')),
    ),
    checkedAt: [],
    stoppedByClaude: false,
  })
}

const isFinished = (job: BackgroundJob): boolean =>
  job.state !== 'running' && job.state !== 'unconfirmed'

const endedWithin = (job: BackgroundJob, now: DateTime.Utc, hold: Duration.Duration): boolean =>
  isFinished(job) && Option.exists(job.endedAt, (ended) => withinHold(ended, now, hold))

const startOrder = Order.mapInput(
  Option.makeOrder(DateTime.Order),
  (job: BackgroundJob) => job.startedAt,
)

const shownOrder = Order.combine(
  Order.mapInput(Order.Boolean, (job: BackgroundJob) => job.state === 'unconfirmed'),
  startOrder,
)

const isInEpisode = (episodeStart: Option.Option<DateTime.Utc>) => (job: BackgroundJob) =>
  !isFinished(job) ||
  Option.exists(Option.all({ start: episodeStart, ended: job.endedAt }), ({ start, ended }) =>
    DateTime.isGreaterThanOrEqualTo(ended, start),
  )

const isChip = (now: DateTime.Utc) => (job: BackgroundJob) =>
  !isFinished(job) || job.state === 'failed' || endedWithin(job, now, DONE_HOLD)

const latestEvent = (jobs: readonly BackgroundJob[]): Option.Option<DockEvent> =>
  pipe(
    jobs,
    Arr.flatMap((job) =>
      Arr.map(job.events, (event) => new DockEvent({ key: job.key, label: job.shortLabel, event })),
    ),
    Arr.match({
      onEmpty: Option.none,
      onNonEmpty: (events) =>
        Option.some(
          Arr.max(
            events,
            Order.mapInput(DateTime.Order, (found: DockEvent) => found.event.at),
          ),
        ),
    }),
  )

const STATE_WORD = {
  running: 'running',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
  unconfirmed: "can't confirm it's running",
} satisfies Record<JobState, string>

export const jobStateWord = (state: JobState): string => STATE_WORD[state]

export const ranFor = (job: BackgroundJob, now: DateTime.Utc): Option.Option<string> =>
  Option.map(job.startedAt, (started) =>
    clockElapsed(
      Option.getOrElse(job.endedAt, () => now),
      started,
    ),
  )

export const lastSeen = (job: BackgroundJob, now: DateTime.Utc): string =>
  Option.match(job.lastSeenAt, {
    onNone: () => 'never seen',
    onSome: (seen) => `last seen ${shortElapsed(now, seen)} ago`,
  })

export const isRoomy = (chips: readonly BackgroundJob[]): boolean => chips.length <= ROOMY_CHIPS

export const backgroundJobs = (options: {
  readonly background: Option.Option<BackgroundChanged>
  readonly runs: readonly DockRun[]
  readonly now: DateTime.Utc
}): readonly BackgroundJob[] => {
  const activities = HashMap.fromIterable(
    Arr.map(
      Option.match(options.background, { onNone: () => [], onSome: (found) => found.activity }),
      (activity) => [activity.subagent, activity] as const,
    ),
  )
  const tasks = Option.match(options.background, {
    onNone: () => [],
    onSome: (found) => found.tasks,
  })

  return [
    ...Arr.map(options.runs, (run) => runJob(run, activities)),
    ...Arr.map(tasks, (task) => taskJob(task, options.now)),
  ]
}

export const dockOf = (jobs: readonly BackgroundJob[], now: DateTime.Utc): DockModel => {
  const running = Arr.filter(jobs, (job) => job.state === 'running')
  const settled = Arr.filter(jobs, (job) => endedWithin(job, now, SETTLE_HOLD))
  const episodeStart = earliestMoment(Arr.map([...running, ...settled], (job) => job.startedAt))
  const settling = running.length === 0 && settled.length > 0
  const active = running.length > 0 || settling
  const rows = pipe(
    jobs,
    Arr.filter((job) => active && isInEpisode(episodeStart)(job)),
    Arr.sort(shownOrder),
  )
  const timed = Arr.filter(rows, (job) => job.state !== 'unconfirmed')

  return new DockModel({
    chips: Arr.filter(rows, isChip(now)),
    rows,
    running: running.length,
    settling,
    since: earliestMoment(Arr.map(timed, (job) => job.startedAt)),
    until: settling ? latestMoment(Arr.map(timed, (job) => job.endedAt)) : Option.none(),
    latest: latestEvent(Arr.filter(rows, (job) => job.state !== 'unconfirmed')),
  })
}

export const isShown = (dock: DockModel): boolean => dock.running > 0 || dock.settling

const spanOf = (job: BackgroundJob): Option.Option<Span> =>
  pipe(
    Option.liftPredicate(job, isFinished),
    Option.flatMap((finished) => finished.endedAt),
    Option.map((end) => ({ job, start: Option.getOrElse(job.startedAt, () => end), end })),
  )

const episodeFrom = (spans: readonly Span[], start: DateTime.Utc): readonly Span[] => {
  const joined = Arr.filter(spans, (span) => DateTime.isGreaterThanOrEqualTo(span.end, start))
  const earliest = Arr.reduce(joined, start, (soonest, span) => DateTime.min(soonest, span.start))

  return DateTime.Equivalence(earliest, start) ? joined : episodeFrom(spans, earliest)
}

const countPart = (
  runs: readonly BackgroundJob[],
  state: JobState,
  text: (count: number) => string,
): readonly SummaryPart[] => {
  const count = Arr.filter(runs, (run) => run.state === state).length

  return count === 0 ? [] : [new SummaryPart({ text: text(count), state })]
}

const subagentParts = (runs: readonly BackgroundJob[]): readonly SummaryPart[] => [
  ...countPart(runs, 'done', (count) => `${count} ${count === 1 ? 'subagent' : 'subagents'} done`),
  ...countPart(runs, 'failed', (count) => `${count} failed`),
  ...countPart(runs, 'stopped', (count) => `${count} stopped`),
]

const summaryParts = (jobs: readonly BackgroundJob[]): readonly SummaryPart[] => {
  const runs = Arr.filter(jobs, (job) => job.kind === 'subagent')
  const tasks = Arr.filter(jobs, (job) => job.kind !== 'subagent')

  return [
    ...subagentParts(runs),
    ...Arr.map(
      tasks,
      (task) =>
        new SummaryPart({
          text: `${task.shortLabel} ${STATE_WORD[task.state]}`,
          state: task.state,
        }),
    ),
  ]
}

const latestSpan = (spans: readonly Span[]): Option.Option<Span> =>
  Arr.match(spans, {
    onEmpty: Option.none,
    onNonEmpty: (all) =>
      Option.some(
        Arr.max(
          all,
          Order.mapInput(DateTime.Order, (span: Span) => span.end),
        ),
      ),
  })

export const summaryDueAt = (jobs: readonly BackgroundJob[]): Option.Option<DateTime.Utc> =>
  pipe(
    jobs,
    Arr.map(spanOf),
    Arr.getSomes,
    latestSpan,
    Option.filter(() => !Arr.some(jobs, (job) => job.state === 'running')),
    Option.map((span) => DateTime.addDuration(span.end, SETTLE_HOLD)),
  )

export const settledEpisode = (options: {
  readonly jobs: readonly BackgroundJob[]
  readonly now: DateTime.Utc
  readonly promptedAt: Option.Option<DateTime.Utc>
}): Option.Option<EpisodeSummary> => {
  const spans = pipe(options.jobs, Arr.map(spanOf), Arr.getSomes)

  return pipe(
    latestSpan(spans),
    Option.filter(
      (last) =>
        Option.exists(summaryDueAt(options.jobs), (due) =>
          DateTime.isLessThanOrEqualTo(due, options.now),
        ) &&
        !Option.exists(options.promptedAt, (prompted) =>
          DateTime.isGreaterThan(prompted, last.end),
        ),
    ),
    Option.map((last) => {
      const episode = Arr.sort(
        episodeFrom(spans, last.start),
        Order.mapInput(DateTime.Order, (span: Span) => span.start),
      )
      const jobs = Arr.map(episode, (span) => span.job)

      return new EpisodeSummary({
        since: Arr.reduce(episode, last.start, (soonest, span) =>
          DateTime.min(soonest, span.start),
        ),
        until: last.end,
        parts: summaryParts(jobs),
        focus: Option.getOrElse(
          Arr.findFirst(jobs, (job) => job.state === 'failed'),
          () => last.job,
        ),
      })
    }),
  )
}
