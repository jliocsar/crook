import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { Prompt } from '@crook/domain/Command'
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
} from '../../test/TranscriptFixtures.ts'
import { chatHerd, chatStory, delivered } from '../ChatFixtures.ts'
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
import { browserStory, linkStory, step } from '../Story.tsx'
import type { BrowserStage, LinkStage, StoryMaker } from '../Story.tsx'

const CARD_BUTTON = new RegExp(CHAT_TITLE, 'u')
const COMPOSER = /Message|Reply/u
const SEND = 'Send'
const BACK = 'Back to Agents'
const QUESTION = 'Now check the toast too'
const WORKING_HERD = liveWith(chatHerd(chatAgent('working', 0)))
const IDLE_HERD = liveWith(chatHerd(chatAgent('idle', 0)))
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
    events: CONVERSATION,
    arrange: (stage) => delivered(stage, '/clear'),
    settle: () => types(COMPOSER, '/clear'),
    timeline: [
      step<LinkStage>(500, 'Send /clear', () => clicks(SEND)),
      step<LinkStage>(500, 'The pane opens a new session', ({ link }) =>
        feed(link, [opened(NEXT_SESSION)]),
      ),
      step<LinkStage>(300, 'Caught up on the empty session', ({ link }) =>
        feed(link, [caughtUp(0, NEXT_SESSION)]),
      ),
      step<LinkStage>(800, 'The first prompt of the new session', ({ link }) =>
        feed(link, [chunk(0, 10, [prompt(0, 'A fresh start.')], NEXT_SESSION)]),
      ),
    ],
  }),
  chatStory({
    slug: 'prompt-to-answer',
    title: 'Prompt, Sent, working, tool, answer',
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
        feed(link, [chunk(50, 60, [prompt(50, QUESTION)])]),
      ),
      step<LinkStage>(900, 'A tool starts', ({ link }) =>
        feed(link, [chunk(60, 70, [toolUse(60, 'toolu_grep', 'Grep', { pattern: 'toast' })])]),
      ),
      step<LinkStage>(800, 'The tool ends', ({ link }) =>
        feed(link, [chunk(70, 80, [toolResult(70, 'toolu_grep', 'src/toast/Toast.tsx:24')])]),
      ),
      step<LinkStage>(1200, 'The answer lands', ({ link }) =>
        feed(link, [chunk(80, 90, [answered(80, 'The toast is fine.')])]),
      ),
      step<LinkStage>(150, 'herdr says idle', ({ link }) =>
        SubscriptionRef.set(link.state, IDLE_HERD),
      ),
    ],
  }),
  browserStory({
    slug: 'herd-first-load-from-cache',
    title: 'Herd first load from the cache, slow hub',
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
  browserStory({
    slug: 'herd-first-load-empty',
    title: 'Herd first load with no cache',
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
