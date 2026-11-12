import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { AgentStatus } from '@crook/domain/AgentStatus'
import { RunCommand, PermissionAsk, UseTool } from '@crook/domain/Ask'
import { AskId, MachineId } from '@crook/domain/Ids'
import { HubStorageFailed } from '@crook/protocol/ClientApi'
import { ANNOUNCED } from '@crook/web/rpc/HubLinkState'

import { liveWith, stateWith } from '../../test/AppWiring.tsx'
import { agent, DESK, herd, LAPTOP, machine, START } from '../../test/HerdFixtures.ts'
import { AGENTS_PATH, TEAM } from '../Fixtures.ts'
import {
  clicks,
  dispatchPointer,
  element,
  fingerPause,
  pressesEvenIfHidden,
  seesText,
  swipes,
} from '../StageDom.ts'
import { linkStory, step } from '../Story.tsx'
import type { LinkStage, LinkStorySpec, StoryMaker } from '../Story.tsx'
import { CLOCK_AFTER_START_SECONDS } from '../StoryEnv.ts'

const SWIPE_LEFT = [200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100]
const FIRST_SWIPE_CARD = '[data-slot="swipe-card"]'
const SWIPE_ACTIONS_OPEN = '[data-slot="swipe-actions"]:not([inert])'
const PULL_DISTANCE = 200
const HERDR_LOST = 'herdr lost'
const LONG_MACHINE_NAME = 'build-server-in-the-basement-rack-two-west'
const NOTHING_RUNNING = 'Nothing running'
const AGENTS_UNSEEN = "Can't see this machine's agents while herdr is away"
const KEPT_TITLE = 'Port the herd screen'
const HEALTHY_TITLE = 'Run the nightly build'
const KEPT_WORKING_CLOCK = '1m 30s'
const KEPT_CARD = '[data-slot="agent-card"][data-kept]'
const LIVE_CARD = '[data-slot="agent-card"]:not([data-kept])'

const LONG_TITLE =
  'Find out why the reconnect banner flashes on every foreground and write down what it would take to stop it'

const lintAsk = new PermissionAsk({
  id: AskId.make('toolu_lint'),
  source: 'hook',
  tool: 'Bash',
  plugin: Option.none(),
  action: new RunCommand({ command: 'bun run lint' }),
  options: [],
  dialog: Option.none(),
})

const toolAsk = (tool: string) =>
  new PermissionAsk({
    id: AskId.make(`toolu_${tool}`),
    source: 'hook',
    tool,
    plugin: Option.none(),
    action: new UseTool({ input: {} }),
    options: [],
    dialog: Option.none(),
  })

const keptRows = [
  agent('w1:p1', 'working', { title: KEPT_TITLE, secondsAgo: 90 }),
  agent('w1:p2', 'blocked', { title: 'Wire the hub link', secondsAgo: 30 }),
  agent('w1:p3', 'idle', { title: 'Tidy the notes', secondsAgo: 600, branch: 'main' }),
]

const lostWithRows = machine(LAPTOP, keptRows, { herdrLostAt: START })

const lostWithEveryStatus = machine(
  LAPTOP,
  [
    ...keptRows,
    agent('w1:p4', 'done', { title: 'Write the banner', secondsAgo: 240 }),
    agent('w1:p5', 'unknown', { title: 'Nothing says yet', secondsAgo: 300 }),
    agent('w1:p6', 'blocked', { title: 'Lint the web package', secondsAgo: 60, ask: lintAsk }),
  ],
  { herdrLostAt: START },
)

const lostWithNothing = (id: MachineId) => machine(id, [], { herdrLostAt: START })

const justNow = DateTime.addDuration(START, Duration.seconds(CLOCK_AFTER_START_SECONDS))

const herdStory = (spec: Omit<LinkStorySpec, 'path'>) => linkStory({ ...spec, path: AGENTS_PATH })

const statusCards = AgentStatus.literals.map((status) =>
  herdStory({
    slug: `card-${status}`,
    title: `Agent card, ${status}`,
    link: liveWith(
      herd([
        machine(LAPTOP, [agent('w1:p1', status, { title: `A ${status} agent`, secondsAgo: 90 })]),
      ]),
    ),
    shows: { text: `A ${status} agent` },
  }),
)

const pulling = (distance: number) =>
  Effect.flatMap(element('[data-slot="pull-to-resync"]'), (zone) =>
    Effect.sync(() => {
      const touch = (clientY: number) =>
        new Touch({ identifier: 1, target: zone, clientX: 100, clientY })

      zone.dispatchEvent(
        new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch(0)] }),
      )
      zone.dispatchEvent(
        new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: [touch(distance)],
        }),
      )
    }),
  )

export const HERD_STORIES: readonly StoryMaker[] = [
  herdStory({
    slug: 'skeleton',
    title: 'Agents, the skeleton of a first visit',
    link: stateWith(ANNOUNCED, Option.none()),
    shows: { selector: '[data-slot="herd-skeleton"]' },
  }),
  herdStory({
    slug: 'full',
    title: 'Agents, two machines at work',
    link: liveWith(TEAM),
    shows: { text: 'Run the nightly build' },
  }),
  herdStory({
    slug: 'no-machines',
    title: 'Agents, no machines yet',
    link: liveWith(herd([])),
    shows: { text: 'No machines yet' },
  }),
  herdStory({
    slug: 'all-offline',
    title: 'Agents, every machine offline',
    link: liveWith(herd([machine(LAPTOP, [], { connection: 'offline' })])),
    shows: { text: 'All machines are offline' },
  }),
  herdStory({
    slug: 'nothing-running',
    title: 'Agents, nothing running',
    link: liveWith(herd([machine(LAPTOP, [])])),
    shows: { text: 'Nothing running' },
  }),
  herdStory({
    slug: 'section-no-agents',
    title: 'Section, a machine with no agents',
    link: liveWith(
      herd([
        machine(LAPTOP, [agent('w1:p1', 'working', { title: 'Port the herd screen' })]),
        machine(DESK, []),
      ]),
    ),
    shows: { text: 'No agents' },
  }),
  herdStory({
    slug: 'section-offline',
    title: 'Section, an offline machine',
    link: liveWith(
      herd([
        machine(LAPTOP, [agent('w1:p1', 'working', { title: 'Port the herd screen' })]),
        machine(DESK, [agent('w2:p1', 'working', { title: 'Hidden' })], {
          connection: 'offline',
        }),
      ]),
    ),
    shows: { text: 'desk' },
  }),
  herdStory({
    slug: 'section-reconnecting',
    title: 'Section, a reconnecting machine',
    link: liveWith(
      herd([
        machine(LAPTOP, [agent('w1:p1', 'working', { title: 'Port the herd screen' })], {
          connection: 'reconnecting',
        }),
      ]),
    ),
    shows: { text: 'Port the herd screen' },
  }),
  herdStory({
    slug: 'herdr-lost',
    title: 'Agents, herdr lost with its rows kept, dimmed and with their clocks stopped',
    link: liveWith(herd([lostWithEveryStatus])),
    shows: {
      all: [
        { text: HERDR_LOST },
        { text: KEPT_WORKING_CLOCK },
        { selector: KEPT_CARD },
        { absent: NOTHING_RUNNING },
      ],
    },
  }),
  herdStory({
    slug: 'herdr-lost-nothing-on-record',
    title: 'Agents, herdr lost with no agents on record',
    link: liveWith(herd([lostWithNothing(LAPTOP)])),
    shows: { all: [{ text: HERDR_LOST }, { text: AGENTS_UNSEEN }, { absent: NOTHING_RUNNING }] },
  }),
  herdStory({
    slug: 'herdr-lost-every-machine',
    title: 'Agents, herdr lost on every machine, none with agents on record',
    link: liveWith(herd([lostWithNothing(LAPTOP), lostWithNothing(DESK)])),
    shows: { all: [{ text: AGENTS_UNSEEN }, { absent: NOTHING_RUNNING }, { absent: 'No agents' }] },
  }),
  herdStory({
    slug: 'herdr-lost-beside-empty',
    title: 'Agents, one machine herdr lost and one known to be empty, so no tab notice',
    link: liveWith(herd([lostWithNothing(LAPTOP), machine(DESK, [])])),
    shows: { all: [{ text: AGENTS_UNSEEN }, { text: 'No agents' }, { absent: NOTHING_RUNNING }] },
  }),
  herdStory({
    slug: 'herdr-lost-beside-offline',
    title: 'Agents, one machine herdr lost and one offline, neither with agents on record',
    link: liveWith(herd([lostWithNothing(LAPTOP), machine(DESK, [], { connection: 'offline' })])),
    shows: {
      all: [
        { text: AGENTS_UNSEEN },
        { text: 'Last seen' },
        { absent: NOTHING_RUNNING },
        { absent: 'All machines are offline' },
      ],
    },
  }),
  herdStory({
    slug: 'herdr-lost-mixed',
    title:
      'Agents, a mix: kept rows dim, a healthy machine stays clear, each empty one says its own',
    link: liveWith(
      herd([
        lostWithRows,
        machine(DESK, [agent('w2:p1', 'working', { title: HEALTHY_TITLE, secondsAgo: 90 })]),
        lostWithNothing(MachineId.make('nas')),
        machine(MachineId.make('rack'), []),
      ]),
    ),
    shows: {
      all: [
        { selector: LIVE_CARD },
        { selector: KEPT_CARD },
        { text: HEALTHY_TITLE },
        { text: AGENTS_UNSEEN },
        { text: 'No agents' },
        { absent: NOTHING_RUNNING },
      ],
    },
  }),
  herdStory({
    slug: 'herdr-lost-long-name',
    title: 'Agents, herdr lost under a long name, beside a count of who needs you',
    link: liveWith(
      herd([machine(LAPTOP, keptRows, { herdrLostAt: START, label: LONG_MACHINE_NAME })]),
    ),
    shows: { all: [{ text: HERDR_LOST }, { text: LONG_MACHINE_NAME }] },
  }),
  herdStory({
    slug: 'herdr-lost-reconnecting',
    title: 'Agents, herdr lost on a machine that is reconnecting, pill and stopped clocks kept',
    link: liveWith(
      herd([machine(LAPTOP, keptRows, { connection: 'reconnecting', herdrLostAt: START })]),
    ),
    shows: { all: [{ text: HERDR_LOST }, { text: KEPT_WORKING_CLOCK }, { selector: KEPT_CARD }] },
  }),
  herdStory({
    slug: 'herdr-lost-and-back',
    title: 'Agents, herdr goes and comes back, its rows dimming and clearing',
    link: liveWith(herd([machine(LAPTOP, keptRows)])),
    shows: { all: [{ text: KEPT_TITLE }, { absent: HERDR_LOST }] },
    ends: { all: [{ text: KEPT_TITLE }, { absent: HERDR_LOST }] },
    timeline: [
      step<LinkStage>(800, 'Herdr stops answering the agent', ({ link }) =>
        SubscriptionRef.set(
          link.state,
          liveWith(herd([machine(LAPTOP, keptRows, { herdrLostAt: justNow })])),
        ),
      ),
      step<LinkStage>(1600, 'Herdr answers again, on a new connection', ({ link }) =>
        Effect.andThen(
          seesText(HERDR_LOST),
          SubscriptionRef.set(
            link.state,
            liveWith(herd([machine(LAPTOP, keptRows, { herdrConnection: 2 })])),
          ),
        ),
      ),
    ],
  }),
  herdStory({
    slug: 'herdr-lost-nothing-then-back',
    title: 'Agents, an agent started with herdr down, then herdr shows its agents',
    link: liveWith(herd([lostWithNothing(LAPTOP)])),
    shows: { all: [{ text: HERDR_LOST }, { absent: NOTHING_RUNNING }] },
    ends: { all: [{ text: KEPT_TITLE }, { absent: HERDR_LOST }] },
    timeline: [
      step<LinkStage>(1600, 'Herdr answers for the first time, with agents', ({ link }) =>
        Effect.andThen(
          seesText(HERDR_LOST),
          SubscriptionRef.set(
            link.state,
            liveWith(herd([machine(LAPTOP, keptRows, { herdrConnection: 2 })])),
          ),
        ),
      ),
    ],
  }),
  herdStory({
    slug: 'section-collapsed',
    title: 'Section, collapsed',
    shows: { selector: '[data-slot="machine-section"] button[aria-expanded="false"]' },
    link: liveWith(TEAM),
    settle: () => clicks(/^laptop/u),
  }),
  ...statusCards,
  herdStory({
    slug: 'card-ask',
    title: 'Agent card, what it asks',
    link: liveWith(
      herd([
        machine(LAPTOP, [
          agent('w1:p1', 'blocked', {
            title: 'Lint the web package',
            ask: lintAsk,
            secondsAgo: 30,
          }),
        ]),
      ]),
    ),
    shows: { text: 'bun run lint' },
  }),
  herdStory({
    slug: 'card-ask-mcp',
    title: 'Agent card, what an MCP tool asks',
    link: liveWith(
      herd([
        machine(LAPTOP, [
          agent('w1:p1', 'blocked', {
            title: 'Send the review',
            ask: toolAsk('mcp__plannotator__send_message'),
            secondsAgo: 30,
          }),
          agent('w1:p2', 'blocked', {
            title: 'Probe the socket',
            ask: toolAsk('mcp__codemode__run'),
            secondsAgo: 40,
          }),
        ]),
      ]),
    ),
    shows: {
      all: [{ text: 'send message from plannotator' }, { text: 'code mode' }, { absent: 'mcp__' }],
    },
  }),
  herdStory({
    slug: 'card-untitled',
    title: 'Agent card, a pane with no title',
    link: liveWith(herd([machine(LAPTOP, [agent('w1:p1', 'working', { title: '' })])])),
    shows: { all: [{ selector: '[data-slot="agent-title"]' }, { absent: 'w1:p1' }] },
  }),
  herdStory({
    slug: 'card-subagents',
    title: 'Agent card, running subagents',
    link: liveWith(
      herd([
        machine(LAPTOP, [
          agent('w1:p1', 'working', {
            title: 'Review the diff',
            branch: 'feat/herd',
            runningSubagents: 3,
          }),
        ]),
      ]),
    ),
    shows: { text: 'Review the diff' },
  }),
  herdStory({
    slug: 'card-pinned',
    title: 'Agent card, pinned',
    link: liveWith(
      herd([
        machine(
          LAPTOP,
          [
            agent('w1:p1', 'working', { title: 'Port the herd screen' }),
            agent('w1:p2', 'idle', { title: 'Pinned to the top' }),
          ],
          { pinned: ['w1:p2'] },
        ),
      ]),
    ),
    shows: { text: 'Pinned to the top' },
  }),
  herdStory({
    slug: 'card-long-title',
    title: 'Agent card, a long title and branch',
    link: liveWith(
      herd([
        machine(LAPTOP, [
          agent('w1:p1', 'working', {
            title: LONG_TITLE,
            branch: 'fix/reconnect-banner-flashes-on-every-foreground-in-the-installed-app',
          }),
        ]),
      ]),
    ),
    shows: { text: LONG_TITLE },
  }),
  herdStory({
    slug: 'many-agents',
    title: 'Agents, a long herd that scrolls',
    link: liveWith(
      herd([
        machine(
          LAPTOP,
          Array.from({ length: 14 }, (_unused, index) =>
            agent(`w1:p${index}`, index % 3 === 0 ? 'working' : 'idle', {
              title: `Agent number ${index}`,
              secondsAgo: index * 60,
            }),
          ),
        ),
      ]),
    ),
    shows: { text: 'Agent number 13' },
  }),
  herdStory({
    slug: 'swipe-open',
    title: 'Agent card, swiped open',
    shows: { selector: SWIPE_ACTIONS_OPEN },
    link: liveWith(TEAM),
    settle: () => swipes(FIRST_SWIPE_CARD, SWIPE_LEFT),
  }),
  herdStory({
    slug: 'swipe-dragging',
    title: 'Agent card, mid swipe',
    shows: { selector: '[data-slot="swipe-card"][style*="translateX(-"]' },
    link: liveWith(TEAM),
    settle: () =>
      Effect.flatMap(element(FIRST_SWIPE_CARD), (card) =>
        Effect.gen(function* () {
          dispatchPointer('pointerdown', card, 200)

          for (const clientX of [190, 180, 170, 160]) {
            yield* fingerPause(16)
            dispatchPointer('pointermove', card, clientX)
          }
        }),
      ),
  }),
  herdStory({
    slug: 'pin-failure',
    title: 'Agent card, the hub refused a pin',
    shows: { text: 'could not save that' },
    link: liveWith(TEAM),
    arrange: ({ link }) =>
      Ref.set(link.pinRefusal, Option.some(new HubStorageFailed({ detail: 'disk full' }))),
    settle: () =>
      Effect.gen(function* () {
        yield* swipes(FIRST_SWIPE_CARD, SWIPE_LEFT)
        yield* pressesEvenIfHidden('Pin')
        yield* seesText('could not save that')
      }),
  }),
  herdStory({
    slug: 'pulling',
    title: 'Pull to resync, mid pull',
    shows: { selector: '[style*="translateY(96px)"]' },
    note: 'Touch events are constructed by hand, so this one needs a browser with Touch.',
    link: liveWith(TEAM),
    settle: () => pulling(PULL_DISTANCE),
  }),
  herdStory({
    slug: 'add-machine-sheet',
    title: 'Add a machine sheet, from the empty herd',
    link: liveWith(herd([])),
    settle: () => clicks('Add a machine'),
    shows: { selector: '[role="dialog"]' },
  }),
]
