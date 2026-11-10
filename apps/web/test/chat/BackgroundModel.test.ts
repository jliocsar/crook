import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'

import { MonitorEvent, MonitorTask, ShellTask, SubagentActivity } from '@crook/domain/Background'
import type { SubagentStatus } from '@crook/domain/Subagent'
import { BackgroundChanged } from '@crook/domain/Transcript'
import {
  activityText,
  backgroundJobs,
  type BackgroundJob,
  commandLabel,
  dockOf,
  type DockRun,
  isShown,
  settledEpisode,
  summaryDueAt,
} from '@crook/web/chat/BackgroundModel'

import { REVIEWER, SESSION } from '../TranscriptFixtures.ts'

const START = DateTime.makeUnsafe('2026-10-30T14:00:00Z')

const at = (seconds: number) => DateTime.add(START, { seconds })

const shell = (options: {
  readonly key: string
  readonly status?: SubagentStatus
  readonly alive?: Option.Option<boolean>
  readonly startedAt?: number
  readonly endedAt?: number
  readonly lastOutputAt?: number
  readonly summary?: string
}) =>
  new ShellTask({
    taskId: `b${options.key}`,
    toolUseId: `toolu_${options.key}`,
    status: options.status ?? 'running',
    summary: Option.fromUndefinedOr(options.summary),
    stoppedByClaude: false,
    startedAt: Option.some(at(options.startedAt ?? 0)),
    endedAt: Option.map(Option.fromUndefinedOr(options.endedAt), at),
    command: Option.some('cd packages/web && bun run dev'),
    description: Option.some('Start the dev server'),
    checkedAt: [],
    output: ['ready in 876 ms', 'Local: http://localhost:5190/'],
    lastOutputAt: Option.some(at(options.lastOutputAt ?? 5)),
    alive: options.alive ?? Option.some(true),
  })

const monitor = (expiresAt: Option.Option<number>) =>
  new MonitorTask({
    taskId: 'bmon',
    toolUseId: 'toolu_mon',
    status: 'running',
    summary: Option.none(),
    stoppedByClaude: false,
    startedAt: Option.some(at(0)),
    endedAt: Option.none(),
    description: 'CI on #212',
    command: Option.none(),
    expiresAt: Option.map(expiresAt, at),
    events: [new MonitorEvent({ at: Option.some(at(30)), text: 'lint passed' })],
  })

const reviewer = (status: DockRun['status'], finishedAt: Option.Option<number>): DockRun => ({
  toolUseId: 'toolu_agent',
  subagent: Option.some(REVIEWER),
  description: 'Review the herd diff',
  agentType: 'code-reviewer',
  model: Option.some('claude-sonnet-4-6'),
  background: true,
  status,
  unconfirmed: false,
  startedAt: Option.some(at(0)),
  finishedAt: Option.map(finishedAt, at),
})

const jobsOf = (
  tasks: BackgroundChanged['tasks'],
  runs: readonly DockRun[],
  now: DateTime.Utc,
  activity: readonly SubagentActivity[] = [],
  paneClosed = false,
) =>
  backgroundJobs({
    background: Option.some(new BackgroundChanged({ session: SESSION, tasks, activity })),
    runs,
    now,
    paneClosed,
  })

const keys = (jobs: readonly BackgroundJob[]) => Arr.map(jobs, (job) => job.key)

const stateOf = (jobs: readonly BackgroundJob[], key: string) =>
  Option.map(
    Arr.findFirst(jobs, (job) => job.key === key),
    (job) => job.state,
  )

describe('activityText', () => {
  const activity = (tool: string, subject: Option.Option<string>) =>
    new SubagentActivity({
      subagent: REVIEWER,
      tool: Option.some(tool),
      subject,
      text: Option.none(),
      at: Option.none(),
    })

  it('reads a tool in words, as the rows of the thread do', () => {
    expect(activityText(activity('mcp__codemode__run', Option.some('Bash')))).toEqual(
      Option.some('code mode(Bash)'),
    )
    expect(activityText(activity('mcp__linear__get_issue', Option.none()))).toEqual(
      Option.some('get issue from linear'),
    )
    expect(activityText(activity('Read', Option.some('a.ts')))).toEqual(Option.some('Read(a.ts)'))
  })
})

describe('backgroundJobs', () => {
  it('cannot confirm a shell whose process is gone though nothing said it ended', () => {
    const jobs = jobsOf([shell({ key: 'gone', alive: Option.some(false) })], [], at(10))

    expect(stateOf(jobs, 'toolu_gone')).toEqual(Option.some('unconfirmed'))
  })

  it('keeps a shell nobody can check running, however long it stays quiet', () => {
    const quiet = shell({ key: 'quiet', alive: Option.none(), lastOutputAt: 0 })

    expect(stateOf(jobsOf([quiet], [], at(60)), 'toolu_quiet')).toEqual(Option.some('running'))
    expect(stateOf(jobsOf([quiet], [], at(24 * 60 * 60)), 'toolu_quiet')).toEqual(
      Option.some('running'),
    )
  })

  it('cannot confirm a Monitor still running past its timeout', () => {
    expect(stateOf(jobsOf([monitor(Option.some(60))], [], at(30)), 'toolu_mon')).toEqual(
      Option.some('running'),
    )
    expect(stateOf(jobsOf([monitor(Option.some(60))], [], at(90)), 'toolu_mon')).toEqual(
      Option.some('unconfirmed'),
    )
  })

  it('keeps a Monitor with no timeout running, however long it stays quiet', () => {
    const persistent = monitor(Option.none())

    expect(stateOf(jobsOf([persistent], [], at(24 * 60 * 60)), 'toolu_mon')).toEqual(
      Option.some('running'),
    )
  })

  it('counts nothing as running once its pane has closed, and leaves what already ended', () => {
    const jobs = jobsOf(
      [shell({ key: 'dev', alive: Option.some(true) }), monitor(Option.none())],
      [
        reviewer('running', Option.none()),
        { ...reviewer('done', Option.some(5)), toolUseId: 'done' },
      ],
      at(10),
      [],
      true,
    )

    expect(dockOf(jobs, at(10)).running).toBe(0)
    expect(stateOf(jobs, 'toolu_dev')).toEqual(Option.some('unconfirmed'))
    expect(stateOf(jobs, 'toolu_mon')).toEqual(Option.some('unconfirmed'))
    expect(stateOf(jobs, reviewer('running', Option.none()).toolUseId)).toEqual(
      Option.some('unconfirmed'),
    )
    expect(stateOf(jobs, 'done')).toEqual(Option.some('done'))
  })

  it('counts no unconfirmed subagent as running, so its clock never shows', () => {
    const run = { ...reviewer('running', Option.none()), unconfirmed: true }
    const jobs = jobsOf([], [run], at(15 * 24 * 60 * 60))

    expect(stateOf(jobs, 'toolu_agent')).toEqual(Option.some('unconfirmed'))
    expect(isShown(dockOf(jobs, at(15 * 24 * 60 * 60)))).toBe(false)
  })

  it('says what a running subagent is doing from its activity', () => {
    const activity = new SubagentActivity({
      subagent: REVIEWER,
      tool: Option.some('Read'),
      subject: Option.some('src/Herd.ts'),
      text: Option.none(),
      at: Option.some(at(4)),
    })
    const jobs = jobsOf([], [reviewer('running', Option.none())], at(5), [activity])

    expect(Option.flatMap(Arr.head(jobs), (job) => job.doing)).toEqual(
      Option.some('Read(src/Herd.ts)'),
    )
  })

  it('names a shell by what it runs, past a change of directory', () => {
    expect(commandLabel('cd packages/web && bun run dev')).toBe('dev')
    expect(commandLabel('npm test')).toBe('test')
  })
})

describe('dockOf', () => {
  it('keeps a finished chip briefly and a failed one while the rest still runs', () => {
    const tasks = [
      shell({ key: 'dev' }),
      shell({ key: 'build', status: 'completed', endedAt: 20 }),
      shell({ key: 'test', status: 'failed', endedAt: 20, summary: 'exit code 1' }),
    ]
    const soon = dockOf(jobsOf(tasks, [], at(22)), at(22))
    const later = dockOf(jobsOf(tasks, [], at(60)), at(60))

    expect(keys(soon.chips)).toEqual(['toolu_dev', 'toolu_build', 'toolu_test'])
    expect(keys(later.chips)).toEqual(['toolu_dev', 'toolu_test'])
    expect(keys(later.rows)).toEqual(['toolu_dev', 'toolu_build', 'toolu_test'])
    expect(later.running).toBe(1)
  })

  it('settles once the last work ends, then goes away', () => {
    const tasks = [shell({ key: 'dev', status: 'stopped', endedAt: 30 })]
    const settling = dockOf(jobsOf(tasks, [], at(35)), at(35))
    const gone = dockOf(jobsOf(tasks, [], at(60)), at(60))

    expect(settling.settling).toBe(true)
    expect(isShown(settling)).toBe(true)
    expect(isShown(gone)).toBe(false)
  })

  it('shows the latest event of all the work, a failure with its reason', () => {
    const tasks = [
      shell({ key: 'dev', lastOutputAt: 5 }),
      shell({ key: 'test', status: 'failed', endedAt: 9, summary: 'exit code 1' }),
    ]
    const dock = dockOf(jobsOf(tasks, [], at(10)), at(10))

    expect(
      Option.map(dock.latest, (latest) => [latest.label, latest.event.text, latest.event.tone]),
    ).toEqual(Option.some(['dev', 'failed: exit code 1', 'bad']))
  })

  it('lists work it cannot confirm last, and does not count it as running', () => {
    const tasks = [
      shell({ key: 'gone', alive: Option.some(false) }),
      shell({ key: 'dev', startedAt: 3 }),
    ]
    const dock = dockOf(jobsOf(tasks, [], at(10)), at(10))

    expect(keys(dock.chips)).toEqual(['toolu_dev', 'toolu_gone'])
    expect(dock.running).toBe(1)
  })

  it('stays hidden when only unconfirmed work is left', () => {
    const tasks = [shell({ key: 'gone', alive: Option.some(false) })]

    expect(isShown(dockOf(jobsOf(tasks, [], at(10)), at(10)))).toBe(false)
  })

  it('counts a running subagent with the background tasks', () => {
    const dock = dockOf(
      jobsOf([shell({ key: 'dev' })], [reviewer('running', Option.none())], at(10)),
      at(10),
    )

    expect(dock.running).toBe(2)
    expect(Arr.map(dock.chips, (job) => job.shortLabel)).toEqual(['Review', 'dev'])
  })
})

describe('settledEpisode', () => {
  const episode = [
    shell({ key: 'old', status: 'completed', startedAt: -600, endedAt: -500 }),
    shell({ key: 'dev', status: 'stopped', endedAt: 30 }),
    shell({ key: 'test', status: 'failed', endedAt: 20, summary: 'exit code 1' }),
  ]
  const runs = [reviewer('done', Option.some(25))]

  const summaryAt = (seconds: number, promptedAt: Option.Option<number> = Option.none()) =>
    settledEpisode({
      jobs: jobsOf(episode, runs, at(seconds)),
      now: at(seconds),
      promptedAt: Option.map(promptedAt, at),
    })

  it('sums up the last episode once the dock has left', () => {
    expect(Option.isNone(summaryAt(35))).toBe(true)
    expect(
      Option.map(summaryAt(50), (summary) => ({
        parts: Arr.map(summary.parts, (part) => [part.text, part.state]),
        focus: summary.focus.key,
        since: summary.since,
        until: summary.until,
      })),
    ).toEqual(
      Option.some({
        parts: [
          ['1 subagent done', 'done'],
          ['dev stopped', 'stopped'],
          ['dev failed', 'failed'],
        ],
        focus: 'toolu_test',
        since: at(0),
        until: at(30),
      }),
    )
  })

  it('leaves the summary out once the user has prompted since', () => {
    expect(Option.isSome(summaryAt(50, Option.some(10)))).toBe(true)
    expect(Option.isNone(summaryAt(50, Option.some(40)))).toBe(true)
  })

  it('says nothing while any work still runs', () => {
    expect(
      Option.isNone(
        settledEpisode({
          jobs: jobsOf([...episode, shell({ key: 'serve', startedAt: 40 })], runs, at(90)),
          now: at(90),
          promptedAt: Option.none(),
        }),
      ),
    ).toBe(true)
  })
})

describe('the end of an episode', () => {
  it('joins work whose times overlap one after another', () => {
    const chain = [
      shell({ key: 'old', status: 'completed', startedAt: -600, endedAt: -500 }),
      shell({ key: 'first', status: 'completed', startedAt: 0, endedAt: 20 }),
      shell({ key: 'second', status: 'completed', startedAt: 15, endedAt: 40 }),
      shell({ key: 'third', status: 'stopped', startedAt: 35, endedAt: 50 }),
    ]
    const summary = settledEpisode({
      jobs: jobsOf(chain, [], at(70)),
      now: at(70),
      promptedAt: Option.none(),
    })

    expect(Option.map(summary, (found) => [found.since, found.until, found.parts.length])).toEqual(
      Option.some([at(0), at(50), 3]),
    )
  })

  it('sums up work that never said when it started', () => {
    const unstamped = new ShellTask(
      Struct.evolve(shell({ key: 'dev', status: 'completed', endedAt: 10 }), {
        startedAt: () => Option.none(),
      }),
    )
    const summary = settledEpisode({
      jobs: jobsOf([unstamped], [], at(30)),
      now: at(30),
      promptedAt: Option.none(),
    })

    expect(Option.map(summary, (found) => [found.since, found.until])).toEqual(
      Option.some([at(10), at(10)]),
    )
  })

  it('is due when the dock leaves, and not while anything runs', () => {
    const ended = shell({ key: 'dev', status: 'completed', endedAt: 30 })

    expect(summaryDueAt(jobsOf([ended], [], at(31)))).toEqual(Option.some(at(44)))
    expect(summaryDueAt(jobsOf([ended, shell({ key: 'serve' })], [], at(31)))).toEqual(
      Option.none(),
    )
  })
})
