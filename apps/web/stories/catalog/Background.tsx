import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { MonitorEvent, MonitorTask, ShellTask, SubagentActivity } from '@crook/domain/Background'
import type { SubagentStatus } from '@crook/domain/Subagent'
import { BackgroundChanged, SubagentsChanged } from '@crook/domain/Transcript'
import { SubagentLaunch } from '@crook/domain/TranscriptMessage'

import { liveWith } from '../../test/AppWiring.tsx'
import { herd, LAPTOP, machine, START } from '../../test/HerdFixtures.ts'
import {
  answered,
  caughtUp,
  chunk,
  opened,
  prompt,
  REVIEWER,
  SESSION,
  subagent,
  toolResult,
  toolUse,
} from '../../test/TranscriptFixtures.ts'
import { chatStory } from '../ChatFixtures.ts'
import { CHAT_SOURCE, chatAgent } from '../Fixtures.ts'
import { clicks, seesText } from '../StageDom.ts'
import { step } from '../Story.tsx'
import type { LinkStage, StoryMaker } from '../Story.tsx'

const NOW = DateTime.addDuration(START, Duration.minutes(5))
const DOCK = '[data-slot="background-dock"]'
const SHELL_BUTTON = 'bun run dev, running'
const LONG_COMMAND = 'bun run --filter @crook/web dev -- --host 0.0.0.0 --port 5173 --strictPort'

const ago = (seconds: number) => DateTime.subtract(NOW, { seconds })

const shell = (status: SubagentStatus = 'running') =>
  new ShellTask({
    taskId: 'bdev',
    toolUseId: 'toolu_dev',
    status,
    summary: Option.none(),
    stoppedByClaude: status === 'stopped',
    startedAt: Option.some(ago(70)),
    endedAt: status === 'running' ? Option.none() : Option.some(ago(5)),
    command: Option.some('bun run dev'),
    description: Option.some('Start the dev server'),
    checkedAt: [ago(30)],
    output: ['ready in 876 ms', 'page reload src/chat/Thread.tsx'],
    lastOutputAt: Option.some(ago(2)),
    alive: Option.some(status === 'running'),
  })

const unconfirmedShell = new ShellTask(
  Struct.evolve(shell(), {
    startedAt: () => Option.some(ago(3 * 60)),
    lastOutputAt: () => Option.some(ago(2 * 60)),
    alive: () => Option.some(false),
  }),
)

const noOutputShell = new ShellTask(
  Struct.evolve(shell(), { output: () => [], lastOutputAt: () => Option.none() }),
)

const monitor = (status: SubagentStatus = 'running') =>
  new MonitorTask({
    taskId: 'mlogs',
    toolUseId: 'toolu_monitor',
    status,
    summary: Option.none(),
    stoppedByClaude: false,
    startedAt: Option.some(ago(120)),
    endedAt: status === 'running' ? Option.none() : Option.some(ago(4)),
    description: 'Watch the build log',
    command: Option.some('tail -f build.log'),
    expiresAt: Option.some(DateTime.addDuration(NOW, Duration.minutes(5))),
    events: [
      new MonitorEvent({ at: Option.some(ago(90)), text: 'Build started' }),
      new MonitorEvent({ at: Option.some(ago(20)), text: 'Build reached 80%' }),
    ],
  })

const reading = new SubagentActivity({
  subagent: REVIEWER,
  tool: Option.some('Read'),
  subject: Option.some('src/Herd.ts'),
  text: Option.none(),
  at: Option.some(ago(1)),
})

const LAUNCHED = chunk(0, 90, [
  prompt(0, 'Bring up the dev server and watch the build'),
  toolUse(10, 'toolu_dev', 'Bash', { command: 'bun run dev', run_in_background: true }),
  toolResult(20, 'toolu_dev', 'Command running in background with ID: bdev.'),
  toolUse(30, 'toolu_monitor', 'Monitor', { description: 'Watch the build log' }),
  toolResult(40, 'toolu_monitor', 'Monitor started (task mlogs, expires in 5m)'),
  toolUse(50, 'toolu_review', 'Agent', {
    description: 'Review the herd diff',
    prompt: 'Read the diff and list the risks.',
    subagent_type: 'code-reviewer',
    run_in_background: true,
  }),
  toolResult(60, 'toolu_review', 'Async agent launched', {
    launch: new SubagentLaunch({ subagent: REVIEWER, status: 'async_launched' }),
  }),
  answered(70, 'All three are running.'),
])

const changed = (tasks: BackgroundChanged['tasks'], runStatus: SubagentStatus = 'running') => [
  opened(),
  LAUNCHED,
  caughtUp(90),
  new SubagentsChanged({
    session: SESSION,
    subagents: [subagent({ toolUseId: 'toolu_review', status: runStatus })],
  }),
  new BackgroundChanged({ session: SESSION, tasks, activity: [reading] }),
]

const dockStory = (
  slug: string,
  title: string,
  tasks: BackgroundChanged['tasks'],
  options: {
    readonly runStatus?: SubagentStatus
    readonly settle?: () => Effect.Effect<void> | ReturnType<typeof clicks>
    readonly shows?: string
  } = {},
) =>
  chatStory({
    slug,
    title,
    row: chatAgent('working'),
    events: changed(tasks, options.runStatus),
    settle: options.settle ?? (() => Effect.void),
    shows: { selector: options.shows ?? DOCK },
  })

const opensDock = () => clicks(/running, show details/u)

const besideToolRow = (status: SubagentStatus) => {
  const task = new ShellTask(
    Struct.evolve(shell(status), { command: () => Option.some(LONG_COMMAND) }),
  )

  return [
    opened(),
    chunk(0, 50, [
      prompt(0, 'Check the Vite config, then bring up the dev server'),
      toolUse(10, 'toolu_read', 'Read', { file_path: 'apps/web/vite.config.ts' }),
      toolResult(20, 'toolu_read', 'export default defineConfig({ server: { port: 5173 } })'),
      toolUse(30, 'toolu_dev', 'Bash', { command: LONG_COMMAND, run_in_background: true }),
      toolResult(40, 'toolu_dev', 'Command running in background with ID: bdev.'),
    ]),
    caughtUp(50),
    new BackgroundChanged({ session: SESSION, tasks: [task], activity: [] }),
  ]
}

export const BACKGROUND_STORIES: readonly StoryMaker[] = [
  dockStory('running', 'Background dock, everything running', [shell(), monitor()]),
  dockStory('expanded', 'Background dock, expanded', [shell(), monitor()], { settle: opensDock }),
  dockStory('settling', 'Background dock, settling', [shell('completed'), monitor('completed')], {
    runStatus: 'completed',
  }),
  dockStory(
    'mixed',
    'Background dock, running beside done and failed',
    [shell('failed'), monitor()],
    { settle: opensDock },
  ),
  dockStory('unconfirmed', 'Background dock, a shell whose process is gone', [unconfirmedShell], {
    settle: opensDock,
  }),
  dockStory('sheet-shell', 'Background sheet, a running shell', [shell()], {
    settle: () => clicks(SHELL_BUTTON),
    shows: '[role="dialog"]',
  }),
  dockStory('sheet-shell-empty', 'Background sheet, nothing printed yet', [noOutputShell], {
    settle: () => clicks(SHELL_BUTTON),
    shows: '[role="dialog"]',
  }),
  dockStory('sheet-monitor', 'Background sheet, a monitor', [monitor()], {
    settle: () => clicks('Watch the build log, running'),
    shows: '[role="dialog"]',
  }),
  chatStory({
    slug: 'marker-running',
    title: 'Background marker, live below',
    row: chatAgent('working'),
    events: changed([shell()]),
    shows: { selector: '[data-slot="background-marker"]' },
  }),
  chatStory({
    slug: 'marker-finished',
    title: 'Background marker, finished',
    events: changed([shell('completed'), monitor('completed')], 'completed'),
    shows: { selector: '[data-slot="background-marker"]' },
  }),
  chatStory({
    slug: 'marker-stopped',
    title: 'Background marker, stopped by Claude',
    events: changed([shell('stopped')], 'stopped'),
    shows: { selector: '[data-slot="background-marker"]' },
  }),
  chatStory({
    slug: 'marker-beside-tool',
    title: 'Background marker, live, under a tool row',
    row: chatAgent('working'),
    events: besideToolRow('running'),
    shows: { selector: '[data-slot="background-marker"]' },
  }),
  chatStory({
    slug: 'marker-beside-tool-finished',
    title: 'Background marker, finished, under a tool row',
    events: besideToolRow('completed'),
    shows: { selector: '[data-slot="background-marker"]' },
  }),
  chatStory({
    slug: 'summary-row',
    title: 'Background summary, the row once all settled',
    shows: { selector: '[data-slot="background-summary"]' },
    note: 'The row appears once the dock has settled, 14 s after the last job ended in the app.',
    events: changed(
      [new ShellTask(Struct.evolve(shell('completed'), { endedAt: () => Option.some(ago(60)) }))],
      'completed',
    ),
  }),
  chatStory({
    slug: 'pane-closes',
    title: 'Background dock, the pane closes while work runs',
    shows: { selector: DOCK },
    ends: { all: [{ text: 'This pane closed' }, { absent: '3 running' }] },
    row: chatAgent('working'),
    events: changed([shell(), monitor()]),
    settle: () => seesText('3 running'),
    timeline: [
      step<LinkStage>(800, 'The pane closes', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(herd([machine(LAPTOP, [])]))),
      ),
    ],
  }),
  chatStory({
    slug: 'dock-to-summary',
    title: 'Background dock, running through to the summary',
    shows: { selector: '[data-slot="background-dock"]' },
    ends: { text: 'All background work finished' },
    row: chatAgent('working'),
    events: changed([shell()]),
    settle: () => seesText('running'),
    timeline: [
      step<LinkStage>(800, 'The shell ends', ({ link }) =>
        Effect.flatMap(link.transcriptFor(CHAT_SOURCE), (transcript) =>
          Queue.offerAll(transcript, [
            new BackgroundChanged({
              session: SESSION,
              tasks: [
                new ShellTask(
                  Struct.evolve(shell('completed'), { endedAt: () => Option.some(NOW) }),
                ),
              ],
              activity: [],
            }),
            new SubagentsChanged({
              session: SESSION,
              subagents: [subagent({ toolUseId: 'toolu_review', status: 'completed' })],
            }),
          ]),
        ),
      ),
    ],
  }),
]
