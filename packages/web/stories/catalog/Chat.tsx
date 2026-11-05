import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { AgentStarted } from '@crook/domain/Command'
import { omittedUpTo } from '@crook/domain/Transcript'
import { TranscriptOffset } from '@crook/domain/Ids'
import { CommandTimedOut } from '@crook/protocol/Commands'
import { TranscriptReadFailed } from '@crook/protocol/Transcripts'
import * as Duration from 'effect/Duration'
import { COLD_START, UNREACHABLE } from '@crook/web/rpc/HubLinkState'

import { liveWith, stateWith } from '../../test/AppWiring.tsx'
import { herd, LAPTOP, machine } from '../../test/HerdFixtures.ts'
import { STARTED_PANE } from '../../test/HubFakes.ts'
import { manyLinesChunk } from '../ManyLines.ts'
import {
  answered,
  caughtUp,
  chunk,
  opened,
  prompt,
  said,
  SESSION,
} from '../../test/TranscriptFixtures.ts'
import { chatHerd, chatStory, shellOnlyHerd } from '../ChatFixtures.ts'
import { CHAT_SOURCE, chatAgent, CONVERSATION, AGENTS_PATH } from '../Fixtures.ts'
import { clicks, element, pause, role, seesSelector, seesText } from '../StageDom.ts'
import type { LinkStage, StoryMaker } from '../Story.tsx'

const RETRY_LABEL = 'Try again'
const SKELETON = '[data-slot="thread-skeleton"]'
const READ_FAILED = new TranscriptReadFailed({ detail: 'disk unplugged' })
const VIEWPORT = '[data-slot="conversation-viewport"]'
const COMMAND_TIMEOUT_SECONDS = 45
const SETTLE_BEFORE_SCROLL_MS = 150

const failWatch = ({ link }: LinkStage) => link.endTranscript(CHAT_SOURCE, READ_FAILED)

const failsOnce = (stage: LinkStage) => Effect.andThen(failWatch(stage), role(RETRY_LABEL))

const leaveAndReopen = ({ router }: LinkStage) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => router.navigate({ to: AGENTS_PATH }))
    yield* pause(50)
    yield* Effect.promise(() =>
      router.navigate({
        to: '/m/$machine/p/$pane',
        params: { machine: LAPTOP, pane: chatAgent().pane },
      }),
    )
  })

const omittedEvents = [
  opened(),
  omittedUpTo(SESSION, TranscriptOffset.make(4096)),
  chunk(4096, 4106, [said(4096, 'The tail of a long session.')]),
  caughtUp(4106),
]

export const CHAT_STORIES: readonly StoryMaker[] = [
  chatStory({
    slug: 'conversation',
    title: 'Chat, idle with a conversation',
    events: CONVERSATION,
    shows: { text: 'The quiet redial keeps the old notice' },
  }),
  chatStory({
    slug: 'skeleton',
    title: 'Chat, thread skeleton before any event',
    shows: { selector: '[data-slot="thread-skeleton"]' },
  }),
  chatStory({
    slug: 'no-messages',
    title: 'Chat, No messages yet',
    events: [opened(), caughtUp(0)],
    shows: { text: 'No messages yet' },
  }),
  chatStory({
    slug: 'presence-loading',
    title: 'Chat, presence loading on a cached herd that lacks the pane',
    link: stateWith(COLD_START, Option.some(herd([machine(LAPTOP, [])]))),
    shows: { selector: '[data-slot="thread-skeleton"]' },
  }),
  chatStory({
    slug: 'away',
    title: 'Chat, the machine went offline',
    link: liveWith(chatHerd(chatAgent(), 'offline')),
    events: CONVERSATION,
    shows: { text: 'laptop is offline' },
  }),
  chatStory({
    slug: 'away-empty',
    title: 'Chat, the machine is offline and nothing is cached',
    link: liveWith(chatHerd(chatAgent(), 'offline')),
    shows: { text: 'No messages on this phone yet' },
  }),
  chatStory({
    slug: 'reconnecting',
    title: 'Chat, the machine is reconnecting',
    note: 'The header says so after a quiet second. The composer stays, and a send holds.',
    link: liveWith(chatHerd(chatAgent(), 'reconnecting')),
    events: CONVERSATION,
    shows: { text: 'laptop reconnecting' },
  }),
  chatStory({
    slug: 'exited',
    title: 'Chat, Claude exited',
    events: CONVERSATION,
    settle: ({ link }) =>
      Effect.andThen(
        seesText('The quiet redial'),
        SubscriptionRef.set(link.state, liveWith(shellOnlyHerd())),
      ),
    shows: { text: 'Claude exited' },
  }),
  chatStory({
    slug: 'closed',
    title: 'Chat, the pane closed',
    events: CONVERSATION,
    settle: ({ link }) =>
      Effect.andThen(
        seesText('The quiet redial'),
        SubscriptionRef.set(link.state, liveWith(herd([machine(LAPTOP, [])]))),
      ),
    shows: { text: 'This pane closed' },
  }),
  chatStory({
    slug: 'closed-empty',
    title: 'Chat, the pane closed and nothing is cached',
    settle: ({ link }) =>
      Effect.andThen(
        seesSelector(SKELETON),
        SubscriptionRef.set(link.state, liveWith(herd([machine(LAPTOP, [])]))),
      ),
    shows: { all: [{ text: 'This pane closed' }, { text: 'No messages on this phone yet' }] },
  }),
  chatStory({
    slug: 'restart-starting',
    title: 'Chat, Start Claude here again waiting',
    shows: { selector: 'button[disabled][aria-busy="true"]' },
    events: CONVERSATION,
    arrange: ({ link }) =>
      Effect.andThen(
        Ref.set(link.commandAnswer, Exit.succeed(new AgentStarted({ pane: STARTED_PANE }))),
        link.commandAnswers.close,
      ),
    settle: ({ link }) =>
      Effect.gen(function* () {
        yield* seesText('The quiet redial')
        yield* SubscriptionRef.set(link.state, liveWith(herd([machine(LAPTOP, [])])))
        yield* clicks('Start Claude here again')
      }),
  }),
  chatStory({
    slug: 'restart-failed',
    title: 'Chat, Start Claude here again failed',
    events: CONVERSATION,
    arrange: ({ link }) =>
      Ref.set(
        link.commandAnswer,
        Exit.fail(
          new CommandTimedOut({
            machine: LAPTOP,
            timeout: Duration.seconds(COMMAND_TIMEOUT_SECONDS),
          }),
        ),
      ),
    settle: ({ link }) =>
      Effect.gen(function* () {
        yield* seesText('The quiet redial')
        yield* SubscriptionRef.set(link.state, liveWith(herd([machine(LAPTOP, [])])))
        yield* clicks('Start Claude here again')
      }),
    shows: { selector: '[role="alert"]' },
  }),
  chatStory({
    slug: 'not-claude',
    title: 'Chat, Not a Claude pane',
    link: liveWith(shellOnlyHerd()),
    shows: { text: 'Not a Claude pane' },
  }),
  chatStory({
    slug: 'catching-up',
    title: 'Chat, Catching up pill on a reopen that runs past the delay',
    events: CONVERSATION,
    settle: (stage) => Effect.andThen(seesText('The quiet redial'), leaveAndReopen(stage)),
    shows: { selector: '[data-slot="catching-up-pill"]' },
  }),
  chatStory({
    slug: 'failed-with-lines',
    title: 'Chat, the watch failed, Try again standing',
    events: CONVERSATION,
    settle: (stage) => Effect.andThen(seesText('The quiet redial'), failsOnce(stage)),
    shows: { text: RETRY_LABEL },
  }),
  chatStory({
    slug: 'failed-empty',
    title: 'Chat, the watch failed with nothing to show',
    settle: (stage) => Effect.andThen(seesSelector(SKELETON), failsOnce(stage)),
    shows: { text: RETRY_LABEL },
  }),
  chatStory({
    slug: 'retrying',
    title: 'Chat, Trying again',
    events: CONVERSATION,
    settle: (stage) =>
      Effect.gen(function* () {
        yield* seesText('The quiet redial')
        yield* failsOnce(stage)
        yield* clicks(RETRY_LABEL)
      }),
    shows: { text: 'Trying again' },
  }),
  chatStory({
    slug: 'show-earlier',
    title: 'Chat, Show earlier messages',
    events: omittedEvents,
    shows: { text: 'Show earlier messages' },
  }),
  chatStory({
    slug: 'show-earlier-pending',
    title: 'Chat, Loading earlier messages',
    events: omittedEvents,
    settle: () => clicks('Show earlier messages'),
    shows: { text: 'Loading earlier messages' },
  }),
  chatStory({
    slug: 'latest-button',
    title: 'Chat, scrolled away with the Latest button',
    note: 'Scrolled by writing scrollTop after a wheel event, so the thread reads a user scroll.',
    events: [opened(), manyLinesChunk(0), caughtUp(1200)],
    settle: () =>
      Effect.flatMap(element(VIEWPORT), (viewport) =>
        Effect.gen(function* () {
          yield* pause(SETTLE_BEFORE_SCROLL_MS)
          viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -2000 }))
          viewport.scrollTop = 0
          viewport.dispatchEvent(new Event('scroll'))
        }),
      ),
    shows: { selector: '[data-slot="conversation-jump"]' },
  }),
  chatStory({
    slug: 'dimmed-stale',
    title: 'Chat, dimmed while the hub is away',
    link: stateWith(UNREACHABLE, Option.some(chatHerd())),
    events: CONVERSATION,
    shows: { selector: '[data-state="dimmed"]' },
  }),
  chatStory({
    slug: 'actions-sheet',
    title: 'Chat, the action sheet from the header',
    events: CONVERSATION,
    settle: () => clicks(/^Actions for/u),
    shows: { selector: '[role="dialog"]' },
  }),
  chatStory({
    slug: 'working-then-idle-hold',
    title: 'Chat, Working row held after herdr went idle',
    row: chatAgent('working', 120),
    events: [opened(), chunk(0, 10, [prompt(0, 'Fix the herd')]), caughtUp(10)],
    settle: ({ link }) =>
      Effect.andThen(
        seesText('Working'),
        SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgent('idle', 0)))),
      ),
    shows: {
      all: [
        { selector: '[data-slot="thinking-state-label"]' },
        { selector: '[data-machine="activity"][data-state="Working"]' },
        { selector: '[data-slot="prompt-input-stop"]' },
      ],
    },
  }),
  chatStory({
    slug: 'answer-before-idle',
    title: 'Chat, the answer landed while herdr still says working',
    row: chatAgent('working', 0),
    events: [
      opened(),
      chunk(0, 20, [prompt(0, 'Fix the herd', 1), answered(10, 'Fixed the herd', 2)]),
      caughtUp(20),
    ],
    shows: {
      all: [
        { text: 'Fixed the herd' },
        { selector: '[data-machine="activity"][data-state="Finished"]' },
        { selector: '[data-slot="prompt-input-submit"]' },
      ],
    },
  }),
]
