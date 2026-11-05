import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { AgentRow } from '@crook/domain/AgentRow'
import { Prompt } from '@crook/domain/Command'
import { TranscriptOffset } from '@crook/domain/Ids'
import { omittedUpTo } from '@crook/domain/Transcript'
import { LocalCommandBlock } from '@crook/domain/TranscriptMessage'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubConnectionLost } from '@crook/web/rpc/HubConnection'

import { liveWith } from '../../test/AppWiring.tsx'
import { START } from '../../test/HerdFixtures.ts'
import { dropSession, inputDelivered } from '../../test/HubFakes.ts'
import {
  answered,
  caughtUp,
  chunk,
  NEXT_SESSION,
  opened,
  prompt,
  said,
  toolResult,
  toolUse,
  user,
} from '../../test/TranscriptFixtures.ts'
import { chatHerd, chatStory, delivered, SEND_READY } from '../ChatFixtures.ts'
import {
  AGENTS_PATH,
  CHAT_PATH,
  CHAT_TITLE,
  chatAgent,
  CONVERSATION,
  feed,
  PANE,
  TEAM,
} from '../Fixtures.ts'
import { clicks, seesText, types } from '../StageDom.ts'
import { CLOCK_AFTER_START_SECONDS } from '../StoryEnv.ts'
import { BEFORE_FIRST_VALUE, browserStory, linkStory, step } from '../Story.tsx'
import type { BrowserStage, LinkStage, StoryMaker } from '../Story.tsx'

const CARD_BUTTON = new RegExp(CHAT_TITLE, 'u')
const COMPOSER = /Message|Reply/u
const SEND = 'Send'
const BACK = 'Back to Agents'
const QUESTION = 'Now check the toast too'
const LIVE_HERD = '[data-slot="herd-list"] [data-dimmed="false"]'
const FLIPS_WORKING_AT = DateTime.add(START, { seconds: CLOCK_AFTER_START_SECONDS })
const FLIPS_IDLE_AT = DateTime.add(FLIPS_WORKING_AT, { seconds: 10 })

const WORKING_HERD = liveWith(
  chatHerd(
    new AgentRow(
      Struct.evolve(chatAgent('working', 0), { statusChangedAt: () => FLIPS_WORKING_AT }),
    ),
  ),
)
const IDLE_HERD = liveWith(
  chatHerd(
    new AgentRow(Struct.evolve(chatAgent('idle', 0), { statusChangedAt: () => FLIPS_IDLE_AT })),
  ),
)

const LOST = new HubConnectionLost({ detail: 'connection refused' })
const CACHED = Option.some(new HerdSnapshot({ view: TEAM, syncedAt: START }))

const takeSession = ({ browser, session }: BrowserStage) =>
  Effect.flatMap(Queue.take(browser.sessions), (next) => Ref.set(session, Option.some(next)))

const currentSession = ({ session }: BrowserStage) =>
  Effect.orDie(Effect.flatMap(Ref.get(session), Effect.fromOption))

export const TRANSITION_STORIES: readonly StoryMaker[] = [
  linkStory({
    slug: 'cold-chat-open',
    title: 'Cold chat open, from a card to a full thread',
    shows: { text: CHAT_TITLE },
    ends: { text: 'The quiet redial' },
    path: AGENTS_PATH,
    link: liveWith(chatHerd()),
    settle: () => seesText(CHAT_TITLE),
    timeline: [
      step<LinkStage>(400, 'Tap the card, the chat slides in on a skeleton', () =>
        clicks(CARD_BUTTON),
      ),
      step<LinkStage>(600, 'The agent opens the session', ({ link }) => feed(link, [opened()])),
      step<LinkStage>(300, 'The backlog lands', ({ link }) => feed(link, CONVERSATION.slice(1, 3))),
      step<LinkStage>(100, 'Caught up', ({ link }) => feed(link, [caughtUp(50)])),
    ],
  }),
  linkStory({
    slug: 'cached-reopen-catch-up',
    title: 'Cached reopen, then a catch-up',
    shows: { text: CHAT_TITLE },
    ends: { text: 'Yes, the notice waits a second now.' },
    path: CHAT_PATH,
    link: liveWith(chatHerd()),
    arrange: ({ link }) => feed(link, CONVERSATION),
    settle: () =>
      Effect.gen(function* () {
        yield* seesText('The quiet redial')
        yield* clicks(BACK)
        yield* seesText(CHAT_TITLE)
      }),
    timeline: [
      step<LinkStage>(700, 'Tap the card, the cached view shows at once', () =>
        clicks(CARD_BUTTON),
      ),
      step<LinkStage>(900, 'What was missed lands', ({ link }) =>
        feed(link, [
          chunk(50, 90, [
            prompt(50, 'Is the banner fixed?'),
            toolUse(60, 'toolu_grep', 'Grep', { pattern: 'announce' }),
            toolResult(70, 'toolu_grep', 'src/rpc/HubLink.ts:64'),
            answered(80, 'Yes, the notice waits a second now.'),
          ]),
        ]),
      ),
      step<LinkStage>(150, 'Caught up', ({ link }) => feed(link, [caughtUp(90)])),
    ],
  }),
  browserStory({
    slug: 'reconnect-chat-open',
    title: 'Reconnect with a chat open, on the real link',
    shows: { text: 'The quiet redial' },
    ends: { text: 'Written while the socket was down.' },
    note: 'Drives the real HubLink over a fake browser, so its delays and its resume are the app’s own.',
    path: CHAT_PATH,
    cached: Option.none(),
    settle: (stage) =>
      Effect.gen(function* () {
        yield* takeSession(stage)
        const session = yield* currentSession(stage)

        yield* Queue.offer(session.views, chatHerd())

        const transcript = yield* Queue.take(session.transcripts)

        yield* Queue.offerAll(transcript, CONVERSATION)
        yield* seesText('The quiet redial')
      }),
    timeline: [
      step<BrowserStage>(800, 'The socket drops', (stage) =>
        Effect.flatMap(currentSession(stage), (session) => dropSession(session, LOST)),
      ),
      step<BrowserStage>(0, 'The link dials again', takeSession),
      step<BrowserStage>(1500, 'The hub answers with the herd', (stage) =>
        Effect.flatMap(currentSession(stage), (session) => Queue.offer(session.views, chatHerd())),
      ),
      step<BrowserStage>(300, 'The transcript resumes with what was missed', (stage) =>
        Effect.gen(function* () {
          const session = yield* currentSession(stage)
          const transcript = yield* Queue.take(session.transcripts)

          yield* Queue.offerAll(transcript, [
            chunk(50, 60, [said(50, 'Written while the socket was down.')]),
            caughtUp(60),
          ])
        }),
      ),
    ],
  }),
  browserStory({
    slug: 'foreground-return',
    title: 'Back from the background, a quiet redial with a chat open',
    shows: { text: 'The quiet redial' },
    ends: { absent: 'Catching up' },
    path: CHAT_PATH,
    cached: Option.none(),
    settle: (stage) =>
      Effect.gen(function* () {
        yield* takeSession(stage)
        const session = yield* currentSession(stage)

        yield* Queue.offer(session.views, chatHerd())

        const transcript = yield* Queue.take(session.transcripts)

        yield* Queue.offerAll(transcript, CONVERSATION)
        yield* seesText('The quiet redial')
      }),
    timeline: [
      step<BrowserStage>(600, 'The phone puts crook away', ({ browser }) =>
        SubscriptionRef.set(browser.visible, false),
      ),
      step<BrowserStage>(800, 'crook comes back', ({ browser }) =>
        SubscriptionRef.set(browser.visible, true),
      ),
      step<BrowserStage>(0, 'The link dials', takeSession),
      step<BrowserStage>(350, 'The hub answers', (stage) =>
        Effect.flatMap(currentSession(stage), (session) => Queue.offer(session.views, chatHerd())),
      ),
      step<BrowserStage>(200, 'The transcript resumes', (stage) =>
        Effect.gen(function* () {
          const session = yield* currentSession(stage)
          const transcript = yield* Queue.take(session.transcripts)

          yield* Queue.offer(transcript, caughtUp(50))
        }),
      ),
    ],
  }),
  chatStory({
    slug: 'machine-redial',
    title: 'Machine redial in a chat, with a draft in the composer',
    shows: { selector: SEND_READY },
    ends: { selector: SEND_READY },
    events: CONVERSATION,
    settle: () => types(COMPOSER, 'Half a thought'),
    timeline: [
      step<LinkStage>(600, 'The machine starts reconnecting', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgent(), 'reconnecting'))),
      ),
      step<LinkStage>(1200, 'The machine is back', ({ link }) =>
        SubscriptionRef.set(link.state, IDLE_HERD),
      ),
    ],
  }),
  chatStory({
    slug: 'clear',
    title: '/clear, from the old session to the new one',
    shows: { text: 'The quiet redial' },
    ends: {
      all: [
        { text: 'A fresh start.' },
        { text: 'Conversation cleared' },
        { absent: 'The quiet redial' },
      ],
    },
    events: CONVERSATION,
    arrange: (stage) => delivered(stage, '/clear'),
    settle: () => types(COMPOSER, '/clear'),
    timeline: [
      step<LinkStage>(500, 'Send /clear', () => clicks(SEND)),
      step<LinkStage>(500, 'The pane opens a new session, and the thread starts over', ({ link }) =>
        feed(link, [
          opened(NEXT_SESSION),
          chunk(
            0,
            10,
            [user(0, [new LocalCommandBlock({ name: '/clear', args: '' })])],
            NEXT_SESSION,
          ),
          caughtUp(10, NEXT_SESSION),
        ]),
      ),
      step<LinkStage>(800, 'The first prompt of the new session', ({ link }) =>
        feed(link, [chunk(10, 20, [prompt(10, 'A fresh start.')], NEXT_SESSION)]),
      ),
    ],
  }),
  chatStory({
    slug: 'resume-other-session',
    title: '/resume, from one session to the tail of another',
    shows: { text: 'The quiet redial' },
    ends: {
      all: [
        { text: 'Where we left off.' },
        { text: 'Show earlier messages' },
        { absent: 'Conversation cleared' },
        { absent: 'The quiet redial' },
      ],
    },
    events: CONVERSATION,
    timeline: [
      step<LinkStage>(600, 'The pane resumes another session, and its tail lands', ({ link }) =>
        feed(link, [
          opened(NEXT_SESSION),
          omittedUpTo(NEXT_SESSION, TranscriptOffset.make(4096)),
          chunk(4096, 4106, [said(4096, 'Where we left off.')], NEXT_SESSION),
          caughtUp(4106, NEXT_SESSION),
        ]),
      ),
    ],
  }),
  chatStory({
    slug: 'prompt-to-answer',
    title: 'Prompt, Sent, working, tool, answer',
    shows: { selector: SEND_READY },
    ends: { text: 'The toast is fine.' },
    events: CONVERSATION,
    arrange: ({ link }) =>
      Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: QUESTION }))),
      ).pipe(Effect.andThen(link.commandAnswers.close)),
    settle: () => types(COMPOSER, QUESTION),
    timeline: [
      step<LinkStage>(500, 'Tap Send, Sending', () => clicks(SEND)),
      step<LinkStage>(400, 'The hub answers, Sent', ({ link }) => link.commandAnswers.open),
      step<LinkStage>(600, 'herdr says working', ({ link }) =>
        SubscriptionRef.set(link.state, WORKING_HERD),
      ),
      step<LinkStage>(500, 'The prompt reaches the transcript', ({ link }) =>
        feed(link, [chunk(50, 60, [prompt(50, QUESTION, CLOCK_AFTER_START_SECONDS + 1)])]),
      ),
      step<LinkStage>(900, 'A tool starts', ({ link }) =>
        feed(link, [
          chunk(60, 70, [
            toolUse(60, 'toolu_grep', 'Grep', { pattern: 'toast' }, CLOCK_AFTER_START_SECONDS + 2),
          ]),
        ]),
      ),
      step<LinkStage>(800, 'The tool ends', ({ link }) =>
        feed(link, [
          chunk(70, 80, [
            toolResult(70, 'toolu_grep', 'src/toast/Toast.tsx:24', {
              seconds: CLOCK_AFTER_START_SECONDS + 3,
            }),
          ]),
        ]),
      ),
      step<LinkStage>(1200, 'The answer lands', ({ link }) =>
        feed(link, [
          chunk(80, 90, [answered(80, 'The toast is fine.', CLOCK_AFTER_START_SECONDS + 4)]),
        ]),
      ),
      step<LinkStage>(150, 'herdr says idle', ({ link }) =>
        SubscriptionRef.set(link.state, IDLE_HERD),
      ),
    ],
  }),
  browserStory({
    slug: 'herd-first-load-from-cache',
    title: 'Herd first load from the cache, slow hub',
    shows: { selector: '[data-dimmed="true"]' },
    ends: { selector: LIVE_HERD },
    path: AGENTS_PATH,
    cached: CACHED,
    settle: () => seesText(CHAT_TITLE),
    timeline: [
      step<BrowserStage>(0, 'The link dials', takeSession),
      step<BrowserStage>(1500, 'The hub answers after the notice showed', (stage) =>
        Effect.flatMap(currentSession(stage), (session) => Queue.offer(session.views, TEAM)),
      ),
    ],
  }),
  browserStory({
    slug: 'herd-first-load-fast',
    title: 'Herd first load from the cache, fast hub',
    shows: { selector: '[data-dimmed="true"]' },
    ends: { selector: LIVE_HERD },
    path: AGENTS_PATH,
    cached: CACHED,
    settle: () => seesText(CHAT_TITLE),
    timeline: [
      step<BrowserStage>(0, 'The link dials', takeSession),
      step<BrowserStage>(200, 'The hub answers before the notice would show', (stage) =>
        Effect.flatMap(currentSession(stage), (session) => Queue.offer(session.views, TEAM)),
      ),
    ],
  }),
  linkStory({
    slug: 'herd-first-link-value',
    title: 'Herd first load, the frames before the link has a first value',
    note: 'The fake browser gives the real link its first value before the first render, so herd-first-load-empty never shows this. The first value here is what a slower cache read would make late.',
    shows: { selector: 'nav[aria-label="Sections"]' },
    ends: { text: 'Loading your agents' },
    path: AGENTS_PATH,
    link: BEFORE_FIRST_VALUE,
    timeline: [
      step<LinkStage>(0, 'The link gives its first value', ({ link }) => link.stateReads.open),
    ],
  }),
  browserStory({
    slug: 'herd-first-load-empty',
    title: 'Herd first load with no cache',
    shows: { text: 'Loading your agents' },
    ends: { text: CHAT_TITLE },
    path: AGENTS_PATH,
    cached: Option.none(),
    timeline: [
      step<BrowserStage>(0, 'The link dials', takeSession),
      step<BrowserStage>(1500, 'The hub answers', (stage) =>
        Effect.flatMap(currentSession(stage), (session) => Queue.offer(session.views, TEAM)),
      ),
    ],
  }),
]
