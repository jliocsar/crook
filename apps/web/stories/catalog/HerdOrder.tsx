import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { AgentStatus } from '@crook/domain/AgentStatus'
import { PaneId, toGlobalPaneId } from '@crook/domain/Ids'
import type { OpenedTimes } from '@crook/domain/OpenedTimes'
import { ComposerDraft, DraftKey } from '@crook/web/cache/DraftCache'

import { liveWith } from '../../test/AppWiring.tsx'
import { agent, herd, LAPTOP, machine, START } from '../../test/HerdFixtures.ts'
import { AGENTS_PATH } from '../Fixtures.ts'
import { clicks, seesText, until } from '../StageDom.ts'
import { linkStory, step } from '../Story.tsx'
import type { LinkStage, StoryMaker, Witness } from '../Story.tsx'

const BACK = 'Back to Agents'
const OPENED_LAST = 'Tidy the notes'

const openedMinutesAgo = (minutes: Readonly<Record<string, number>>): OpenedTimes => ({
  [LAPTOP]: Object.fromEntries(
    Object.entries(minutes).map(([pane, ago]) => [
      PaneId.make(pane),
      DateTime.subtractDuration(START, Duration.minutes(ago)),
    ]),
  ),
})

const inOrder = (panes: readonly string[]): Witness => ({
  all: panes.map((pane, index) => ({
    selector: `[data-agent="${toGlobalPaneId(LAPTOP, PaneId.make(pane))}"]:nth-child(${index + 1})`,
  })),
})

const everyGroup = machine(
  LAPTOP,
  [
    agent('w1:p1', 'working', { title: 'Port the herd screen', secondsAgo: 30 }),
    agent('w1:p2', 'idle', { title: 'Pinned to the top', secondsAgo: 900 }),
    agent('w1:p3', 'blocked', { title: 'Wire the hub link', secondsAgo: 60 }),
    agent('w1:p4', 'working', { title: 'Half a prompt typed', secondsAgo: 45 }),
    agent('w1:p5', 'done', { title: 'Write the banner', secondsAgo: 120 }),
    agent('w1:p6', 'idle', { title: 'Tidy the notes', secondsAgo: 600 }),
    agent('w1:p7', 'blocked', { title: 'Lint the web package', secondsAgo: 300 }),
    agent('w1:p8', 'working', { title: 'Review the diff', secondsAgo: 20 }),
    agent('w1:p9', 'unknown', { title: 'Nothing says yet', secondsAgo: 240 }),
  ],
  { pinned: ['w1:p2'] },
)

const STEADY_TITLES = [
  'Port the herd screen',
  'Wire the hub link',
  'Tidy the notes',
  'Review the diff',
  'Run the nightly build',
]

const steadyLaptop = (statuses: readonly AgentStatus[]) =>
  machine(
    LAPTOP,
    STEADY_TITLES.map((title, index) =>
      agent(`w1:p${index + 1}`, statuses[index] ?? 'idle', { title, secondsAgo: 60 * index }),
    ),
    { seen: ['w1:p1', 'w1:p2', 'w1:p3', 'w1:p4', 'w1:p5'] },
  )

const STEADY_OPENED = openedMinutesAgo({ 'w1:p4': 1, 'w1:p2': 5, 'w1:p5': 9 })
const STEADY_ORDER = ['w1:p4', 'w1:p2', 'w1:p5', 'w1:p1', 'w1:p3']

const flipsTo = (label: string, statuses: readonly AgentStatus[]) =>
  step<LinkStage>(700, label, ({ link }) =>
    SubscriptionRef.set(link.state, liveWith(herd([steadyLaptop(statuses)]))),
  )

const quietLaptop = machine(LAPTOP, [
  agent('w1:p1', 'working', { title: 'Port the herd screen', secondsAgo: 30 }),
  agent('w1:p2', 'idle', { title: 'Wire the hub link', secondsAgo: 300 }),
  agent('w1:p3', 'idle', { title: OPENED_LAST, secondsAgo: 600 }),
])

const chatHasLeft = until(
  'the chat to leave',
  () => document.querySelector('[data-slot="pushed-screen"]') === null,
)

const chatHasArrived = until(
  'the chat to arrive',
  () =>
    document.querySelector('[data-slot="pushed-screen"]')?.contains(document.activeElement) ===
    true,
)

export const HERD_ORDER_STORIES: readonly StoryMaker[] = [
  linkStory({
    slug: 'every-group',
    title:
      'Agents in order: pinned, a draft, blocked oldest first, unseen done, then the last opened',
    path: AGENTS_PATH,
    link: liveWith(herd([everyGroup])),
    marks: { opened: openedMinutesAgo({ 'w1:p8': 1, 'w1:p6': 5 }) },
    arrange: ({ link }) =>
      link.draftStore.seed(
        HashMap.make([
          new DraftKey({ machine: LAPTOP, pane: PaneId.make('w1:p4') }),
          new ComposerDraft({ text: 'And then check the', attachments: [] }),
        ]),
      ),
    shows: inOrder([
      'w1:p2',
      'w1:p4',
      'w1:p7',
      'w1:p3',
      'w1:p5',
      'w1:p8',
      'w1:p6',
      'w1:p1',
      'w1:p9',
    ]),
  }),
  linkStory({
    slug: 'steady-through-flips',
    title: 'Agents flip between working and settled, and every card stays where it is',
    path: AGENTS_PATH,
    link: liveWith(herd([steadyLaptop(['working', 'idle', 'idle', 'working', 'done'])])),
    marks: { opened: STEADY_OPENED },
    shows: inOrder(STEADY_ORDER),
    ends: inOrder(STEADY_ORDER),
    timeline: [
      flipsTo('Two finish and one starts', ['idle', 'working', 'idle', 'done', 'done']),
      flipsTo('Everyone gets to work', ['working', 'working', 'working', 'working', 'working']),
      flipsTo('Everyone settles', ['idle', 'done', 'idle', 'done', 'unknown']),
    ],
  }),
  linkStory({
    slug: 'opened-goes-first',
    title: 'Open a chat and go back: that agent now leads the ones that need nothing',
    path: AGENTS_PATH,
    link: liveWith(herd([quietLaptop])),
    settle: () => seesText(OPENED_LAST),
    shows: inOrder(['w1:p1', 'w1:p2', 'w1:p3']),
    ends: inOrder(['w1:p3', 'w1:p1', 'w1:p2']),
    timeline: [
      step<LinkStage>(400, 'Tap the last card, its chat slides over the list', () =>
        clicks(new RegExp(OPENED_LAST, 'u')),
      ),
      step<LinkStage>(1600, 'Read a moment, then tap back: the opened agent is first', () =>
        chatHasArrived.pipe(Effect.andThen(clicks(BACK)), Effect.andThen(chatHasLeft)),
      ),
    ],
  }),
]
