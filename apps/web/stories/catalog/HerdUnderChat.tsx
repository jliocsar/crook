import * as Effect from 'effect/Effect'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { AgentRow } from '@crook/domain/AgentRow'

import { liveWith } from '../../test/AppWiring.tsx'
import { agent, DESK, herd, LAPTOP, machine } from '../../test/HerdFixtures.ts'
import {
  AGENTS_PATH,
  CHAT_TITLE,
  chatAgent,
  CONVERSATION,
  feed,
  MACHINE_PATH,
} from '../Fixtures.ts'
import { clicks, seesText, swipes, types, until } from '../StageDom.ts'
import { linkStory, step } from '../Story.tsx'
import type { LinkStage, StoryMaker, TimelineStep } from '../Story.tsx'

const CARD_BUTTON = new RegExp(CHAT_TITLE, 'u')
const BACK = 'Back to Agents'
const BACK_TO_MACHINE = 'Back to laptop'
const MACHINE_SCREEN_WITNESS = 'About'
const COMPOSER = /Message|Reply/u
const DRAFT = 'One more thing before you go'
const ARRIVED_UNDER_CHAT = 'Sweep the release notes'
const EDGE_BACK = '[data-slot="edge-back"]'
const SHORT_SWIPE = [0, 30, 60, 90, 110]
const SLOW_SWIPE_STEP_MS = 150
const FULL_SWIPE = [0, 60, 120, 180, 240, 300]

const chatHasArrived = until(
  'the chat to arrive',
  () =>
    Array.from(document.querySelectorAll('[data-slot="pushed-screen"]'))
      .at(-1)
      ?.contains(document.activeElement) === true,
)

const chatHasLeft = until(
  'the chat to leave',
  () => document.querySelector('[data-machine="transcript"]') === null,
)

const goesBack = clicks(BACK).pipe(Effect.andThen(chatHasLeft))

const onLaptopUnderChat = (rows: readonly AgentRow[]) =>
  machine(LAPTOP, [chatAgent('idle'), ...rows], {
    agentVersion: '0.0.2',
    herdrVersion: '0.9.5',
  })

const onDeskUnderChat = (rows: readonly AgentRow[]) =>
  machine(DESK, rows, { agentVersion: '0.0.2', herdrVersion: '0.9.5' })

const BEFORE_MOVING_UNDER_CHAT = herd([
  onLaptopUnderChat([
    agent('w1:p2', 'blocked', { title: 'Wire the hub link', secondsAgo: 180 }),
    agent('w1:p3', 'done', { title: 'Write the banner', secondsAgo: 600 }),
    agent('w1:p4', 'idle', { title: 'Port the herd screen', secondsAgo: 3600 }),
  ]),
  onDeskUnderChat([agent('w2:p1', 'working', { title: 'Run the nightly build', secondsAgo: 900 })]),
])

const MOVED_UNDER_CHAT = herd([
  onLaptopUnderChat([
    agent('w1:p2', 'blocked', { title: 'Wire the hub link', secondsAgo: 180 }),
    agent('w1:p4', 'idle', { title: 'Port the herd screen', secondsAgo: 3600 }),
  ]),
  onDeskUnderChat([
    agent('w2:p1', 'blocked', { title: 'Run the nightly build', secondsAgo: 2 }),
    agent('w2:p2', 'working', { title: ARRIVED_UNDER_CHAT, secondsAgo: 1 }),
  ]),
])

const othersMoveAfter = (delayMs: number) =>
  step<LinkStage>(delayMs, 'Other machines move: one asks, one leaves, one arrives', ({ link }) =>
    SubscriptionRef.set(link.state, liveWith(MOVED_UNDER_CHAT)),
  )

const typesInTheChat = step<LinkStage>(
  700,
  'Type in the chat, so the list holds for a moment',
  () => chatHasArrived.pipe(Effect.andThen(types(COMPOSER, DRAFT))),
)

const herdUnderChatStory = (
  slug: string,
  title: string,
  leaves: readonly TimelineStep<LinkStage>[],
): StoryMaker =>
  linkStory({
    slug,
    title,
    shows: { text: CHAT_TITLE },
    ends: { text: ARRIVED_UNDER_CHAT },
    path: AGENTS_PATH,
    link: liveWith(BEFORE_MOVING_UNDER_CHAT),
    settle: () => seesText(CHAT_TITLE),
    timeline: [
      step<LinkStage>(400, 'Tap the card, the chat slides over the list', () =>
        clicks(CARD_BUTTON),
      ),
      step<LinkStage>(1100, 'The transcript lands', ({ link }) => feed(link, CONVERSATION)),
      ...leaves,
    ],
  })

const chatFromMachineStory = (
  slug: string,
  title: string,
  leaves: readonly TimelineStep<LinkStage>[],
): StoryMaker =>
  linkStory({
    slug,
    title,
    shows: { text: CHAT_TITLE },
    ends: { text: MACHINE_SCREEN_WITNESS },
    path: MACHINE_PATH,
    link: liveWith(BEFORE_MOVING_UNDER_CHAT),
    settle: () => seesText(CHAT_TITLE),
    timeline: [
      step<LinkStage>(400, 'Tap the card, the chat slides over the machine screen', () =>
        clicks(CARD_BUTTON),
      ),
      step<LinkStage>(1100, 'The transcript lands', ({ link }) => feed(link, CONVERSATION)),
      ...leaves,
    ],
  })

export const HERD_UNDER_CHAT_STORIES: readonly StoryMaker[] = [
  herdUnderChatStory(
    'herd-moves-under-chat-then-back',
    'The list moves under an open chat, then a back tap shows it already right',
    [
      othersMoveAfter(700),
      step<LinkStage>(700, 'Tap back, the list is right from the first frame', () => goesBack),
    ],
  ),
  herdUnderChatStory(
    'herd-moves-under-chat-then-swipe',
    'The list moves under an open chat, then a swipe shows it already right',
    [
      othersMoveAfter(700),
      step<LinkStage>(700, 'Swipe part of the way and let go, the chat comes back', () =>
        chatHasArrived.pipe(Effect.andThen(swipes(EDGE_BACK, SHORT_SWIPE, SLOW_SWIPE_STEP_MS))),
      ),
      step<LinkStage>(900, 'Swipe past the line, the chat leaves', () =>
        swipes(EDGE_BACK, FULL_SWIPE).pipe(Effect.andThen(chatHasLeft)),
      ),
    ],
  ),
  herdUnderChatStory(
    'herd-moves-while-typing-then-back',
    'The list moves while typing in the chat, then a back tap inside the hold shows it right',
    [
      typesInTheChat,
      othersMoveAfter(200),
      step<LinkStage>(200, 'Tap back while the list still holds', () => goesBack),
    ],
  ),
  herdUnderChatStory(
    'herd-moves-while-typing-then-swipe',
    'The list moves while typing in the chat, then a swipe inside the hold shows it right',
    [
      typesInTheChat,
      othersMoveAfter(200),
      step<LinkStage>(200, 'Swipe while the list still holds', () =>
        swipes(EDGE_BACK, FULL_SWIPE).pipe(Effect.andThen(chatHasLeft)),
      ),
    ],
  ),
  chatFromMachineStory(
    'chat-from-machine-then-back',
    'A chat opened from a machine screen slides over that screen, and a back tap reveals it',
    [
      step<LinkStage>(700, 'Tap back, the machine screen is under the chat as it leaves', () =>
        clicks(BACK_TO_MACHINE).pipe(Effect.andThen(chatHasLeft)),
      ),
    ],
  ),
  chatFromMachineStory(
    'chat-from-machine-then-swipe',
    'A chat opened from a machine screen slides over that screen, and a swipe reveals it',
    [
      step<LinkStage>(700, 'Swipe part of the way and let go, the chat comes back', () =>
        chatHasArrived.pipe(Effect.andThen(swipes(EDGE_BACK, SHORT_SWIPE, SLOW_SWIPE_STEP_MS))),
      ),
      step<LinkStage>(900, 'Swipe past the line, the chat leaves', () =>
        swipes(EDGE_BACK, FULL_SWIPE).pipe(Effect.andThen(chatHasLeft)),
      ),
    ],
  ),
]
