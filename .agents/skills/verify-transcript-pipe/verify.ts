import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

import { followDisagreements } from './FollowReplay'
import { replayOnce } from './Replay'
import { type TraceState, behaviourIn } from './TraceReader'

const SKILL = import.meta.dir
const ROOT = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd: SKILL })
  .stdout.toString()
  .trim()
const RUN = join(ROOT, 'tmp', 'verify-transcript-pipe')
const TLC_VERSION = 'TLC2 Version 2.19'
const HEAP = '-Xmx1g'

const BASE = {
  SessionPath: 'PathStraight',
  FirstFileLines: 1,
  TailLines: 1,
  MailboxCapacity: 2,
  SwitchQueueSize: 2,
  Writes: 1,
  PaneGaps: 0,
  AgentDrops: 0,
  PhoneDrops: 0,
  WatchFailures: 0,
  Reopens: 0,
  ShowEarliers: 0,
  SocketsMayReorder: false,
  WalkLength: 60,
  Broken: 'none',
}

type Constants = Partial<typeof BASE>

interface Check {
  readonly name: string
  readonly says: string
  readonly constants: Constants
  readonly rules: readonly string[]
  readonly property?: string
  readonly breaks?: string
  readonly replay?: boolean
  readonly reach?: boolean
}

const HOLDS_ON_MAIN = [
  'NoDuplicateLine',
  'NoHole',
  'OneSessionShown',
  'NoRepeatedOpen',
  'NeverRewinds',
  'NeverStuckCatchingUp',
  'ShowsPaneSession',
  'NeverBehindFile',
  'WholeShowsAll',
  'AtMostTwoHoles',
]

const finding = (
  name: string,
  says: string,
  rule: string,
  constants: Constants,
): Check => ({ name, says, constants, rules: [rule], breaks: rule, replay: true })

const holds = (name: string, says: string, constants: Constants): Check => ({
  name,
  says,
  constants,
  rules: HOLDS_ON_MAIN,
})

const mutant = (broken: string, rule: string, constants: Constants, says: string): Check => ({
  name: `can-fail/${broken}`,
  says,
  constants: { ...constants, Broken: broken },
  rules: rule === 'AlwaysSettles' ? [] : [rule],
  ...(rule === 'AlwaysSettles' ? { property: rule } : {}),
  breaks: rule,
})

const STALE_SOCKET: Constants = { AgentDrops: 1, SocketsMayReorder: true }
const RETURN: Constants = { SessionPath: 'PathReturn' }
const DROPS: Constants = { AgentDrops: 1 }
const BACKLOG: Constants = { SessionPath: 'PathOne', FirstFileLines: 3, TailLines: 3, Writes: 0 }
const BIG_GAP: Constants = { SessionPath: 'PathOne', Writes: 3, SwitchQueueSize: 1 }
const REPEATED_GAPS: Constants = { ...BIG_GAP, MailboxCapacity: 1, Writes: 6, Reopens: 3 }

const HOLDING: readonly Check[] = [
  holds('holds/agent-and-phone-drop', 'both connections die once, lines and a /clear racing them', {
    AgentDrops: 1,
    PhoneDrops: 1,
  }),
  holds('holds/follow-fails', 'the follow fails once, read or resume rejected, then Try again', {
    WatchFailures: 1,
  }),
  holds('holds/late-publish-from-dead-socket', "a dead socket's call lands after its successor has spoken, with a /clear between", STALE_SOCKET),
  holds('holds/chat-reopens', 'the chat closes and opens from the cache', { Reopens: 1 }),
  holds('holds/pane-loses-claude', 'the agent row loses its session and gets it back', {
    PaneGaps: 1,
  }),
  holds('holds/backlog-over-full-mailboxes', 'more lines than a mailbox takes, an agent drop among them', {
    ...BACKLOG,
    AgentDrops: 1,
  }),
  holds('holds/tail-then-writes', 'a cold open with a tail, more lines, an agent drop', {
    SessionPath: 'PathOne',
    FirstFileLines: 2,
    Writes: 2,
    AgentDrops: 1,
    SwitchQueueSize: 1,
  }),
  holds('holds/reopen-over-big-gap', 'the chat reopens over a gap too big for one read, and the agent skips it with an agent drop racing the skip', {
    ...BIG_GAP,
    Reopens: 1,
    AgentDrops: 1,
  }),
  holds('holds/reconnect-over-big-gap', 'the phone reconnects over a gap too big for one read, with more lines written during the skip', {
    ...BIG_GAP,
    Writes: 4,
    PhoneDrops: 1,
  }),
  holds('holds/show-earlier-at-hole', 'Show earlier is pressed at a hole, and the whole watch fills it with no repeated line', {
    ...BIG_GAP,
    Reopens: 1,
    ShowEarliers: 1,
  }),
  holds('holds/repeated-gaps', 'the chat keeps reopening over big gaps, and what it holds stays bounded', REPEATED_GAPS),
  holds('holds/return-over-big-gap', 'the pane goes A, B, A and the chat reopens on a gap too big for one read', {
    ...RETURN,
    Writes: 3,
    Reopens: 1,
    SwitchQueueSize: 1,
    MailboxCapacity: 1,
  }),
  holds('holds/late-publish-over-big-gap', "a dead socket's skip lands after its successor has spoken", {
    ...BIG_GAP,
    ...STALE_SOCKET,
    Reopens: 1,
  }),
  holds('holds/return-inside-switch-queue', 'the pane goes A, B, A with the first open still queued, and the phone ends with each line of A once', RETURN),
  {
    name: 'holds/every-retry-ends',
    says: 'no restart loop: the pipe always reaches a point with nothing left to do',
    constants: { AgentDrops: 1, SwitchQueueSize: 1 },
    rules: [],
    property: 'AlwaysSettles',
  },
]

const FINDINGS: readonly Check[] = [
  finding('finding/open-chat-gains-a-hole-per-drop', 'a chat left open gains a hole per reconnect over a wide gap, until the next open folds them', 'AtMostTwoHoles', {
    ...BIG_GAP,
    MailboxCapacity: 1,
    Writes: 6,
    PhoneDrops: 3,
  }),
]

const reach = (name: string, says: string, property: string, constants: Constants): Check => ({
  name,
  says,
  constants,
  rules: [],
  property,
  breaks: property,
  replay: true,
  reach: true,
})

const REACHED: readonly Check[] = [
  reach('reach/live-chunk-refused', 'a chunk that does not continue the position is refused, and the agent restarts from where the hub says', 'NoLiveChunkRefused', RETURN),
  reach('reach/caught-up-refused', 'a caught-up mark past what the hub delivered is refused, and the agent restarts from where the hub says', 'NoCaughtUpRefused', RETURN),
  reach('reach/fenced-call-dropped', "a dead socket's call lands after a later link asked for demands, and the hub drops it", 'NoFencedCallDropped', STALE_SOCKET),
  reach('reach/dead-socket-interrupted', "the hub sees a dead socket and interrupts its call between two updates", 'NoDeadSocketSeen', STALE_SOCKET),
  reach('reach/hole-landed', 'a resume over a big gap reaches the phone as a chunk that continues its position', 'NoHoleLanded', {
    ...BIG_GAP,
    Reopens: 1,
  }),
  reach('reach/earlier-shown', 'Show earlier starts the view over and reads the file again', 'NoEarlierShown', {
    ...BIG_GAP,
    FirstFileLines: 2,
    Writes: 0,
    ShowEarliers: 1,
  }),
  reach('reach/hole-on-return', 'the pane goes A, B, A, and a reopen lands a hole', 'NoHoleLanded', {
    ...RETURN,
    Writes: 3,
    Reopens: 1,
    SwitchQueueSize: 1,
    MailboxCapacity: 1,
  }),
  reach('reach/hole-folded', 'a view that holds two holes is opened from the cache with one', 'NoHoleFolded', REPEATED_GAPS),
  reach('reach/call-on-gone-watch', 'a call lands after its watch has failed and left the map', 'NoCallOnGoneWatch', { ...STALE_SOCKET, WatchFailures: 1 }),
]

const CAN_FAIL: readonly Check[] = [
  mutant('relay-no-continuity', 'NoDuplicateLine', RETURN, 'append without continuesFrom'),
  mutant('forward-two-steps', 'NoDuplicateLine', DROPS, 'forward moves the position after the transaction'),
  mutant('relay-forgets-resume', 'NoDuplicateLine', { PhoneDrops: 1 }, 'delivered starts empty instead of at from'),
  mutant('reset-keeps-lines', 'OneSessionShown', { WatchFailures: 1 }, 'settle clears the position but keeps the lines'),
  mutant('open-keeps-lines', 'OneSessionShown', {}, 'applyTranscriptEvent keeps the lines of the session it leaves'),
  {
    ...mutant('open-keeps-lines', 'NoDuplicateLine', RETURN, 'the same, on a return to a session the phone already showed'),
    name: 'can-fail/open-keeps-lines-on-return',
  },
  mutant('omitted-not-marked', 'NoHole', { SessionPath: 'PathOne', FirstFileLines: 2 }, 'omittedUpTo without its OmittedLines'),
  {
    ...mutant('omitted-not-marked', 'NoHole', { ...BIG_GAP, Reopens: 1 }, 'a skip over a gap without its OmittedLines'),
    name: 'can-fail/skip-not-marked',
  },
  mutant('skip-from-start', 'AlwaysSettles', { ...BIG_GAP, Reopens: 1 }, 'a skip over a gap says it starts at byte 0, not at the position'),
  mutant('whole-takes-tail', 'WholeShowsAll', { ...BIG_GAP, FirstFileLines: 2, Writes: 0, ShowEarliers: 1 }, 'a whole watch skips as if it had a tail'),
  mutant('no-fold', 'AtMostTwoHoles', REPEATED_GAPS, 'the cache hands back every hole it holds'),
  mutant('fold-not-marked', 'NoHole', REPEATED_GAPS, 'the rows a fold drops leave no mark at the start of the file'),
  mutant('open-not-filtered', 'NoRepeatedOpen', DROPS, 'deliver forwards every TranscriptOpened'),
  mutant('no-fence', 'NeverRewinds', STALE_SOCKET, "a dead socket's call counts after a later link asked for demands"),
  mutant('caught-up-unchecked', 'NeverBehindFile', RETURN, 'passOnCaughtUp forwards a mark past the delivered position'),
  mutant('caught-up-dropped', 'NeverStuckCatchingUp', {}, 'forwardInSession drops the caught-up mark'),
  mutant('mailbox-holds-when-full', 'NeverStuckCatchingUp', BACKLOG, 'awaitsCatchUp without the isFull check'),
  mutant('no-switch', 'ShowsPaneSession', {}, 'followPane ignores a session change'),
  mutant('follow-stops-at-caught-up', 'NeverBehindFile', {}, 'tail.follow stops reading at its first caught-up'),
  mutant('restart-from-watch-from', 'AlwaysSettles', { PaneGaps: 1, SwitchQueueSize: 1 }, 'attempt(watch.from) instead of attempt(outOfStep.expected)'),
  mutant('updates-out-of-order', 'AlwaysSettles', { SessionPath: 'PathStraight', SwitchQueueSize: 1 }, 'eventsOf puts chunks before their open'),
]

const ONLY_WHEN_BROKEN = ['ForwardMovesPosition', 'HubDropsCaughtUp']
const WALK_SEEDS = [11, 23, 37, 41, 53, 67, 79, 83, 97, 101]
const WALK_CONSTANTS: Constants = {
  SessionPath: 'PathReturn',
  Writes: 3,
  PaneGaps: 1,
  AgentDrops: 2,
  PhoneDrops: 2,
  WatchFailures: 2,
  Reopens: 1,
  ShowEarliers: 1,
  SocketsMayReorder: true,
}

const tlaValue = (value: unknown) =>
  typeof value === 'boolean'
    ? value
      ? 'TRUE'
      : 'FALSE'
    : typeof value === 'string' && value.startsWith('Path')
      ? value
      : typeof value === 'string'
        ? `"${value}"`
        : String(value)

const configFor = (constants: Constants, rules: readonly string[], property?: string) => {
  const all = { ...BASE, ...constants }
  const lines = Object.entries(all).map(([name, value]) =>
    name === 'SessionPath' ? `  ${name} <- ${value}` : `  ${name} = ${tlaValue(value)}`,
  )

  return [
    'SPECIFICATION Spec',
    'CONSTANTS',
    '  NONE = NONE',
    ...lines,
    ...rules.map((rule) => `INVARIANT ${rule}`),
    ...(property ? [`PROPERTY ${property}`] : []),
    '',
  ].join('\n')
}

const runTlc = async (name: string, config: string, flags: readonly string[] = []) => {
  const slug = name.replaceAll('/', '-')
  const configPath = join(RUN, `${slug}.cfg`)
  const outPath = join(RUN, `${slug}.out`)
  const metadir = join(RUN, 'states', slug)

  writeFileSync(configPath, config)

  const started = performance.now()
  const tlc = Bun.spawn(
    ['tlc', '-workers', '1', '-metadir', metadir, ...flags, '-config', `${slug}.cfg`, 'TranscriptPipe.tla'],
    {
      cwd: RUN,
      env: { ...process.env, JAVA_TOOL_OPTIONS: HEAP },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [stdout, stderr] = await Promise.all([
    new Response(tlc.stdout).text(),
    new Response(tlc.stderr).text(),
  ])

  await tlc.exited
  rmSync(metadir, { recursive: true, force: true })
  writeFileSync(outPath, stdout + stderr)

  const invariant = /Invariant (\w+) is violated/.exec(stdout)?.[1]
  const actionProperty = /Action property (\w+) is violated/.exec(stdout)?.[1]
  const temporal = /Temporal properties were violated/.test(stdout)
  const clean = /Model checking completed\. No error has been found/.test(stdout)
  const distinct = [...stdout.matchAll(/([\d,]+) distinct states found/g)].at(-1)?.[1] ?? '?'

  return {
    stdout,
    outPath,
    configPath,
    seconds: Math.round((performance.now() - started) / 100) / 10,
    distinct,
    broke: invariant ?? actionProperty ?? (temporal ? 'AlwaysSettles' : undefined),
    clean,
    version: stdout.includes(TLC_VERSION),
  }
}

const changedLines = (states: readonly TraceState[]) => {
  const watched = (vars: TraceState['vars']) => ({
    position: vars['view'].position,
    lines: vars['view'].lines,
    catching: vars['view'].catching,
    delivered: vars['watcher'].delivered,
    pane: vars['pane'].at,
  })

  return states.map((state, index) => {
    const now = watched(state.vars)
    const before = index === 0 ? undefined : watched((states[index - 1] as TraceState).vars)
    const moved = Object.entries(now)
      .filter(
        ([key, value]) =>
          before === undefined ||
          JSON.stringify(value) !== JSON.stringify(before[key as keyof typeof before]),
      )
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)

    return `  ${index + 1}. ${state.action}${moved.length > 0 ? `  ${moved.join(' ')}` : ''}`
  })
}

const coverage = () => {
  const skill = readFileSync(join(SKILL, 'SKILL.md'), 'utf8')
  const sync = /^Sync commit: `([0-9a-f]+)`/m.exec(skill)?.[1]
  const files = (/```coverage\n([\s\S]*?)```/.exec(skill)?.[1] ?? '')
    .split('\n')
    .map((line) => line.split(/\s+/)[0] ?? '')
    .filter((line) => line.length > 0)
  const diff = Bun.spawnSync(['git', 'diff', '--name-only', sync ?? 'HEAD', '--', ...files], {
    cwd: ROOT,
  })

  return { sync, files, changed: diff.stdout.toString().split('\n').filter(Boolean) }
}

const stepsOfTheModel = () => {
  const model = readFileSync(join(SKILL, 'model', 'TranscriptPipe.tla'), 'utf8')
  const steps = model.slice(model.indexOf('HubStep =='), model.indexOf('Quiescent =='))

  return [...steps.matchAll(/\\\/ (?:\\E \w+ \\in \w+ : )?(\w+)/g)]
    .map((match) => match[1] ?? '')
    .filter((step) => step !== 'HubStep' && !ONLY_WHEN_BROKEN.includes(step))
}

const only = process.argv.find((argument, index) => process.argv[index - 1] === '--only')
const selected = (name: string) => only === undefined || name.includes(only)

const main = async () => {
  rmSync(RUN, { recursive: true, force: true })
  mkdirSync(RUN, { recursive: true })
  copyFileSync(join(SKILL, 'model', 'TranscriptPipe.tla'), join(RUN, 'TranscriptPipe.tla'))

  const problems: string[] = []
  const walked = new Set<string>()
  const started = performance.now()
  const report = (ok: boolean, line: string) => console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`)

  const runCheck = async (check: Check) => {
    const result = await runTlc(check.name, configFor(check.constants, check.rules, check.property))

    if (!result.version) {
      problems.push(`${check.name}: this is not ${TLC_VERSION}; see ${result.outPath}`)
    }

    const expected = check.breaks
    const asExpected = expected === undefined ? result.clean : result.broke === expected
    const states = behaviourIn(result.stdout)
    const tail = `${result.distinct} states, ${result.seconds}s`

    if (!asExpected) {
      const seen =
        result.broke !== undefined
          ? `${result.broke} breaks`
          : result.clean
            ? 'every rule holds'
            : 'TLC stopped on an error'

      report(false, `${check.name}: ${seen}, expected ${expected ? `${expected} to break` : 'every rule to hold'} (${tail})`)
      console.log(`     ${check.says}`)
      console.log(changedLines(states).join('\n'))
      console.log(`     config ${result.configPath}\n     output ${result.outPath}`)
      problems.push(check.name)

      return
    }

    if (check.replay === true) {
      try {
        const replayed = await replayOnce(states, check.constants.MailboxCapacity ?? BASE.MailboxCapacity)

        report(true, `${check.name}: ${check.reach === true ? 'reached' : `${expected} breaks`}, and the real code walks the same ${states.length} steps (${tail})`)
        console.log(`     ends with ${JSON.stringify(replayed.view)}`)
        for (const state of states) walked.add(state.action)
      } catch (error) {
        report(false, `${check.name}: the real code does not walk this path: ${String(error)}`)
        console.log(changedLines(states).join('\n'))
        problems.push(check.name)
      }

      return
    }

    report(true, `${check.name}: ${expected ? `${expected} breaks as it should` : 'every rule holds'} (${tail})`)
  }

  for (const check of [...HOLDING, ...FINDINGS, ...REACHED, ...CAN_FAIL]) {
    if (selected(check.name)) await runCheck(check)
  }

  if (selected('replay/walks')) {
    for (const seed of WALK_SEEDS) {
      const walk = await runTlc(
        `replay/walk-${seed}`,
        configFor(WALK_CONSTANTS, ['WalkEnds']),
        ['-simulate', '-depth', '200', '-seed', String(seed)],
      )
      const states = behaviourIn(walk.stdout)

      try {
        if (states.length === 0) throw new Error(`no walk came out; see ${walk.outPath}`)
        await replayOnce(states, BASE.MailboxCapacity)
        report(true, `replay/walk-${seed}: the real relay, mailbox and view agree over ${states.length} random steps`)
        for (const state of states) walked.add(state.action)
      } catch (error) {
        report(false, `replay/walk-${seed}: ${String(error)}`)
        console.log(changedLines(states).join('\n'))
        console.log(`     output ${walk.outPath}`)
        problems.push(`replay/walk-${seed}`)
      }
    }
  }

  if (selected('replay/follow')) {
    const follow = await followDisagreements(join(RUN, 'claude-root'))

    report(follow.problems.length === 0, `replay/follow: the real TranscriptStreams.follow agrees on ${follow.cases - follow.problems.length} of ${follow.cases} cases`)
    for (const problem of follow.problems) {
      console.log(`     ${problem}`)
      problems.push(problem)
    }
  }

  if (only === undefined) {
    const missed = stepsOfTheModel().filter((step) => !walked.has(step))

    report(missed.length === 0, `replay/every-step: ${missed.length === 0 ? 'the real code walked every step of the model' : `the real code never walked ${missed.join(', ')}; a break in them would go unseen`}`)
    if (missed.length > 0) problems.push('replay/every-step')
  }

  const covered = coverage()
  const seconds = Math.round((performance.now() - started) / 1000)

  if (covered.changed.length > 0) {
    console.log(`\nNEEDS ANOTHER LOOK: covered code changed since the sync commit ${covered.sync}:`)
    for (const file of covered.changed) console.log(`  ${file}`)
    console.log('Read the change against the model (SKILL.md, "When a change is intended"), then move the sync commit.')
  }

  console.log(
    problems.length === 0
      ? `\nEverything as expected in ${seconds}s. Output in ${RUN}.`
      : `\n${problems.length} not as expected in ${seconds}s. Output in ${RUN}. Read SKILL.md, "Bug or modeling error".`,
  )

  process.exit(problems.length > 0 ? 1 : covered.changed.length > 0 ? 2 : 0)
}

await main()
