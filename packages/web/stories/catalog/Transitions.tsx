import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { AgentRow } from '@crook/domain/AgentRow'
import { Prompt } from '@crook/domain/Command'
import { TranscriptOffset } from '@crook/domain/Ids'
import { omittedBetween, omittedUpTo } from '@crook/domain/Transcript'
import type { TranscriptEvent } from '@crook/domain/Transcript'
import { TranscriptReadFailed, TranscriptResumeRejected } from '@crook/protocol/Transcripts'
import { LocalCommandBlock } from '@crook/domain/TranscriptMessage'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubConnectionLost } from '@crook/web/rpc/HubConnection'

import { liveWith } from '../../test/AppWiring.tsx'
import { herd, LAPTOP, machine, START } from '../../test/HerdFixtures.ts'
import { dropSession, inputDelivered } from '../../test/HubFakes.ts'
import {
  answered,
  caughtUp,
  chunk,
  NEXT_SESSION,
  opened,
  prompt,
  said,
  SESSION,
  toolResult,
  toolUse,
  user,
} from '../../test/TranscriptFixtures.ts'
import { chatHerd, chatStory, delivered, SEND_READY } from '../ChatFixtures.ts'
import {
  AGENTS_PATH,
  CHAT_PATH,
  CHAT_SOURCE,
  CHAT_TITLE,
  chatAgent,
  CONVERSATION,
  feed,
  PANE,
  TEAM,
} from '../Fixtures.ts'
import { MANY_LINES_END, manyLinesChunk, MANY_TURNS_END, manyTurnsChunk } from '../ManyLines.ts'
import { clicks, element, pause, seesSelector, seesText, types, until } from '../StageDom.ts'
import { CLOCK_AFTER_START_SECONDS } from '../StoryEnv.ts'
import { BEFORE_FIRST_VALUE, browserStory, linkStory, step } from '../Story.tsx'
import type { BrowserStage, LinkStage, StoryMaker, StoryStepFailed } from '../Story.tsx'

const CARD_BUTTON = new RegExp(CHAT_TITLE, 'u')
const COMPOSER = /Message|Reply/u
const SEND = 'Send'
const BACK = 'Back to Agents'
const QUESTION = 'Now check the toast too'
const HELD_PROMPT = 'Sent while crook was dialing'
const LIVE_HERD = '[data-slot="herd-list"] [data-state="clear"]'
const RETRY = 'Try again'
const SHOW_EARLIER = 'Show earlier messages'
const OLDER_AGENT_VERSION = '0.0.0'
const CURRENT_THREAD = '[data-machine="transcript"][data-state="Current"]'
const GAP_END = 4096
const LONG_GAP_END = 5000
const LONG_ABOVE_LINES = 6
const LONG_LINE_BYTES = 10
const LONG_SETTLE_MS = 1000
const VIEWPORT = '[data-slot="conversation-viewport"]'

const HELD_THREAD =
  '[data-machine="transcript"][data-state="Holding"], [data-machine="transcript"][data-state="CatchingUp"]'

const FLIPS_WORKING_AT = DateTime.add(START, { seconds: CLOCK_AFTER_START_SECONDS })
const FLIPS_IDLE_AT = DateTime.add(FLIPS_WORKING_AT, { seconds: 10 })

const GAP_THEN_TAIL = [
  omittedBetween(SESSION, TranscriptOffset.make(50), TranscriptOffset.make(GAP_END)),
  chunk(GAP_END, GAP_END + 40, [
    prompt(GAP_END, 'Is the banner fixed?'),
    toolUse(GAP_END + 10, 'toolu_grep', 'Grep', { pattern: 'announce' }),
    toolResult(GAP_END + 20, 'toolu_grep', 'src/rpc/HubLink.ts:64'),
    answered(GAP_END + 30, 'Yes, the notice waits a second now.'),
  ]),
  caughtUp(GAP_END + 40),
]

const messagesOf = (event: TranscriptEvent): readonly TranscriptMessage[] =>
  Match.value(event).pipe(
    Match.tag('TranscriptChunk', (found) => found.messages),
    Match.orElse(() => []),
  )

const goesBackToTheHerd = clicks(BACK).pipe(
  Effect.andThen(
    until(
      'the chat to leave',
      () => document.querySelector('[data-machine="transcript"]') === null,
    ),
  ),
  Effect.andThen(seesText(CHAT_TITLE)),
)

const TALL_ANSWER = 'The quiet redial keeps the old notice until the attempt ends. '.repeat(20)
const TALL_ROWS_END = 30

const TALL_ROWS: readonly TranscriptEvent[] = [
  opened(),
  chunk(0, TALL_ROWS_END, [
    answered(0, TALL_ANSWER),
    answered(10, TALL_ANSWER),
    answered(20, TALL_ANSWER),
  ]),
  caughtUp(TALL_ROWS_END),
]

const reopenFromTheCard = () => Effect.andThen(seesText('The quiet redial'), goesBackToTheHerd)

const linesOver = (from: number, count: number, word: string) =>
  chunk(
    from,
    from + count * LONG_LINE_BYTES,
    Arr.makeBy(count, (index) => said(from + index * LONG_LINE_BYTES, `${word} ${index}`)),
  )

const scrollsToTheTop = Effect.flatMap(element(VIEWPORT), (viewport) =>
  Effect.sync(() => {
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -viewport.scrollTop }))
    viewport.scrollTop = 0
    viewport.dispatchEvent(new Event('scroll'))
  }),
)

const showEarlierAtHoleStory = (
  slug: string,
  title: string,
  tailLines: number,
  reachTheHole: Effect.Effect<unknown, StoryStepFailed>,
) => {
  const tailEnd = LONG_GAP_END + tailLines * LONG_LINE_BYTES
  const tail = linesOver(LONG_GAP_END, tailLines, 'Tail')

  return linkStory({
    slug,
    title,
    shows: { text: CHAT_TITLE },
    ends: { all: [{ absent: SHOW_EARLIER }, { absent: 'Loading earlier messages' }] },
    path: CHAT_PATH,
    link: liveWith(chatHerd()),
    arrange: ({ link }) =>
      feed(link, [
        opened(),
        linesOver(0, LONG_ABOVE_LINES, 'Above'),
        omittedBetween(
          SESSION,
          TranscriptOffset.make(LONG_ABOVE_LINES * LONG_LINE_BYTES),
          TranscriptOffset.make(LONG_GAP_END),
        ),
        tail,
        caughtUp(tailEnd),
      ]),
    settle: () =>
      pause(LONG_SETTLE_MS).pipe(
        Effect.andThen(reachTheHole),
        Effect.andThen(pause(LONG_SETTLE_MS)),
      ),
    timeline: [
      step<LinkStage>(700, 'Tap Show earlier, it reads the file again', () => clicks(SHOW_EARLIER)),
      step<LinkStage>(900, 'The whole file lands', ({ link }) =>
        feed(link, [
          opened(),
          linesOver(0, LONG_ABOVE_LINES, 'Above'),
          chunk(
            LONG_ABOVE_LINES * LONG_LINE_BYTES,
            LONG_GAP_END,
            Arr.makeBy(40, (index) =>
              said(LONG_ABOVE_LINES * LONG_LINE_BYTES + index, `Filled ${index}`),
            ),
          ),
          tail,
          caughtUp(tailEnd),
        ]),
      ),
    ],
  })
}

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

const OLDER_AGENT_HERD = liveWith(
  herd([
    machine(LAPTOP, [chatAgent()], { agentVersion: OLDER_AGENT_VERSION, herdrVersion: '0.9.5' }),
  ]),
)

const READ_FAILED = new TranscriptReadFailed({ detail: 'disk unplugged' })
const RESUME_REJECTED = new TranscriptResumeRejected({ detail: 'the file shrank' })

const OMITTED_TAIL = [
  opened(),
  omittedUpTo(SESSION, TranscriptOffset.make(4096)),
  chunk(4096, 4106, [said(4096, 'The tail of a long session.')]),
  caughtUp(4106),
]
const WHOLE_FILE = [
  chunk(0, 4106, [prompt(0, 'How it began.'), said(4096, 'The tail of a long session.')]),
  caughtUp(4106),
]

const LOST = new HubConnectionLost({ detail: 'connection refused' })
const CACHED = Option.some(new HerdSnapshot({ view: TEAM, syncedAt: START }))

const takeSession = ({ browser, session }: BrowserStage) =>
  Effect.flatMap(Queue.take(browser.sessions), (next) => Ref.set(session, Option.some(next)))

const reopens = () => Effect.andThen(clicks(CARD_BUTTON), seesSelector(HELD_THREAD))

const watchesFor = ({ link }: LinkStage, nthTime: number) =>
  until(
    `the transcript watched ${nthTime} times`,
    () => Ref.getUnsafe(link.resumes).length >= nthTime,
  )

const currentSession = ({ session }: BrowserStage) =>
  Effect.orDie(Effect.flatMap(Ref.get(session), Effect.fromOption))

const reopenedChat = (slug: string, title: string, landsAfterMs: number) =>
  linkStory({
    slug,
    title,
    shows: { text: CHAT_TITLE },
    ends: { all: [{ text: 'Written while the chat was closed.' }, { selector: CURRENT_THREAD }] },
    path: CHAT_PATH,
    link: liveWith(chatHerd()),
    arrange: ({ link }) => feed(link, CONVERSATION),
    settle: () =>
      Effect.gen(function* () {
        yield* seesText('The quiet redial')
        yield* goesBackToTheHerd
      }),
    timeline: [
      step<LinkStage>(700, 'Tap the card, the cached view shows at once', reopens),
      step<LinkStage>(landsAfterMs, 'What was missed lands', ({ link }) =>
        feed(link, [chunk(50, 60, [said(50, 'Written while the chat was closed.')]), caughtUp(60)]),
      ),
    ],
  })

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
    ends: {
      all: [
        { text: 'Yes, the notice waits a second now.' },
        { selector: '[data-row="catch-up"] + [data-row]:has([data-role="user"])' },
      ],
    },
    path: CHAT_PATH,
    link: liveWith(chatHerd()),
    arrange: ({ link }) => feed(link, CONVERSATION),
    settle: () =>
      Effect.gen(function* () {
        yield* seesText('The quiet redial')
        yield* goesBackToTheHerd
      }),
    timeline: [
      step<LinkStage>(700, 'Tap the card, the cached view shows at once', reopens),
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
  linkStory({
    slug: 'reopen-over-big-gap',
    title: 'Reopen over a big gap, the rows it held above Show earlier',
    shows: { text: CHAT_TITLE },
    ends: {
      all: [
        { text: 'The quiet redial' },
        { text: SHOW_EARLIER },
        { text: 'Yes, the notice waits a second now.' },
      ],
    },
    path: CHAT_PATH,
    link: liveWith(chatHerd()),
    arrange: ({ link }) => feed(link, CONVERSATION),
    settle: reopenFromTheCard,
    timeline: [
      step<LinkStage>(700, 'Tap the card, the cached view shows at once', () =>
        clicks(CARD_BUTTON),
      ),
      step<LinkStage>(900, 'The agent skips the gap, and the tail lands', ({ link }) =>
        feed(link, GAP_THEN_TAIL),
      ),
    ],
  }),
  linkStory({
    slug: 'reopen-over-big-gap-long',
    title: 'Reopen over a big gap, a tail longer than the screen',
    shows: { text: CHAT_TITLE },
    ends: { all: [{ selector: '[data-following]' }, { absent: 'Catching up' }] },
    path: CHAT_PATH,
    link: liveWith(chatHerd()),
    arrange: ({ link }) => feed(link, CONVERSATION),
    settle: reopenFromTheCard,
    timeline: [
      step<LinkStage>(700, 'Tap the card, the cached view shows at once', () =>
        clicks(CARD_BUTTON),
      ),
      step<LinkStage>(900, 'The agent skips the gap, and a long tail lands', ({ link }) =>
        feed(link, [
          omittedBetween(SESSION, TranscriptOffset.make(50), TranscriptOffset.make(GAP_END)),
          manyLinesChunk(GAP_END),
          caughtUp(GAP_END + 1200),
        ]),
      ),
    ],
  }),
  linkStory({
    slug: 'long-catch-up',
    title: 'A catch-up of short rows longer than the screen, with no hole',
    shows: { text: CHAT_TITLE },
    ends: {
      all: [{ selector: '[data-following]' }, { absent: 'Catching up' }, { text: 'Line 119' }],
    },
    path: CHAT_PATH,
    link: liveWith(chatHerd()),
    arrange: ({ link }) => feed(link, CONVERSATION),
    settle: reopenFromTheCard,
    timeline: [
      step<LinkStage>(700, 'Tap the card, the cached view shows at once', () =>
        clicks(CARD_BUTTON),
      ),
      step<LinkStage>(900, 'What was missed lands, many short rows of it', ({ link }) =>
        feed(link, [manyLinesChunk(50), caughtUp(50 + MANY_LINES_END)]),
      ),
    ],
  }),
  linkStory({
    slug: 'long-catch-up-turns',
    title: 'A catch-up of whole turns longer than the screen, with no hole',
    shows: { text: CHAT_TITLE },
    ends: {
      all: [{ selector: '[data-following]' }, { absent: 'Catching up' }, { text: 'Answer 15' }],
    },
    path: CHAT_PATH,
    link: liveWith(chatHerd()),
    arrange: ({ link }) => feed(link, CONVERSATION),
    settle: reopenFromTheCard,
    timeline: [
      step<LinkStage>(700, 'Tap the card, the cached view shows at once', () =>
        clicks(CARD_BUTTON),
      ),
      step<LinkStage>(900, 'What was missed lands, many turns of it', ({ link }) =>
        feed(link, [manyTurnsChunk(50), caughtUp(50 + MANY_TURNS_END)]),
      ),
    ],
  }),
  linkStory({
    slug: 'long-catch-up-over-tall-rows',
    title: 'A catch-up of short rows over a view of a few tall ones',
    shows: { text: CHAT_TITLE },
    ends: {
      all: [{ selector: '[data-following]' }, { absent: 'Catching up' }, { text: 'Line 119' }],
    },
    path: CHAT_PATH,
    link: liveWith(chatHerd()),
    arrange: ({ link }) => feed(link, TALL_ROWS),
    settle: reopenFromTheCard,
    timeline: [
      step<LinkStage>(700, 'Tap the card, the cached view shows at once', () =>
        clicks(CARD_BUTTON),
      ),
      step<LinkStage>(900, 'What was missed lands, many short rows of it', ({ link }) =>
        feed(link, [manyLinesChunk(TALL_ROWS_END), caughtUp(TALL_ROWS_END + MANY_LINES_END)]),
      ),
    ],
  }),
  linkStory({
    slug: 'show-earlier-at-hole',
    title: 'Show earlier at a hole, the whole file fills it',
    shows: { text: SHOW_EARLIER },
    ends: {
      all: [
        { text: 'What the gap held.' },
        { text: 'The quiet redial' },
        { absent: SHOW_EARLIER },
        { absent: 'Loading earlier messages' },
      ],
    },
    path: CHAT_PATH,
    link: liveWith(chatHerd()),
    arrange: ({ link }) => feed(link, [...CONVERSATION, ...GAP_THEN_TAIL]),
    timeline: [
      step<LinkStage>(700, 'Tap Show earlier, it reads the file again', () => clicks(SHOW_EARLIER)),
      step<LinkStage>(900, 'The whole file lands', ({ link }) =>
        feed(link, [
          opened(),
          chunk(0, 50, Arr.flatMap(CONVERSATION, messagesOf)),
          chunk(50, GAP_END, [said(50, 'What the gap held.')]),
          ...Arr.drop(GAP_THEN_TAIL, 1),
        ]),
      ),
    ],
  }),
  showEarlierAtHoleStory(
    'show-earlier-at-hole-long',
    'Show earlier at a hole, scrolled up to it',
    40,
    scrollsToTheTop,
  ),
  showEarlierAtHoleStory(
    'show-earlier-at-hole-following',
    'Show earlier at a hole, still at the end',
    12,
    pause(0),
  ),
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
    slug: 'send-through-redial',
    title: 'Send during a quiet redial, held until the new connection answers',
    note: 'The composer stays open while the link dials, and Send waits for the dial instead of failing.',
    shows: { selector: SEND_READY },
    ends: { text: HELD_PROMPT },
    path: CHAT_PATH,
    cached: Option.none(),
    settle: (stage) =>
      Effect.gen(function* () {
        yield* takeSession(stage)
        const session = yield* currentSession(stage)

        yield* Ref.set(
          stage.browser.commandAnswer,
          Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: HELD_PROMPT }))),
        )
        yield* Queue.offer(session.views, chatHerd())

        const transcript = yield* Queue.take(session.transcripts)

        yield* Queue.offerAll(transcript, CONVERSATION)
        yield* seesText('The quiet redial')
        yield* types(COMPOSER, HELD_PROMPT)
      }),
    timeline: [
      step<BrowserStage>(600, 'The phone goes to the background and back', ({ browser }) =>
        SubscriptionRef.set(browser.visible, false).pipe(
          Effect.andThen(SubscriptionRef.set(browser.visible, true)),
        ),
      ),
      step<BrowserStage>(0, 'The link dials', takeSession),
      step<BrowserStage>(200, 'Tap Send while it dials', () => clicks(SEND)),
      step<BrowserStage>(500, 'The hub answers, and the held send goes out', (stage) =>
        Effect.flatMap(currentSession(stage), (session) => Queue.offer(session.views, chatHerd())),
      ),
      step<BrowserStage>(900, 'The transcript resumes', (stage) =>
        Effect.gen(function* () {
          const session = yield* currentSession(stage)
          const transcript = yield* Queue.take(session.transcripts)

          yield* Queue.offer(transcript, caughtUp(50))
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
  reopenedChat('slow-catch-up', 'A catch-up slow enough to say so, the words then the rows', 1800),
  reopenedChat(
    'catch-up-lands-under-words',
    'A catch-up that lands just after the words show, they hold for as long as they must',
    1100,
  ),
  chatStory({
    slug: 'opened-empty',
    title: 'A session with nothing in it, from the skeleton to No messages yet',
    shows: { selector: '[data-slot="thread-skeleton"]' },
    ends: { text: 'No messages yet' },
    timeline: [
      step<LinkStage>(700, 'The agent has read the session and found nothing', ({ link }) =>
        feed(link, [opened(), caughtUp(0)]),
      ),
    ],
  }),
  chatStory({
    slug: 'failed-then-retry',
    title: 'A watch fails, Try again, and it delivers',
    shows: { text: 'The quiet redial' },
    ends: { all: [{ selector: CURRENT_THREAD }, { absent: RETRY }] },
    events: CONVERSATION,
    timeline: [
      step<LinkStage>(500, 'The watch fails, the rows stay', ({ link }) =>
        link.endTranscript(CHAT_SOURCE, READ_FAILED),
      ),
      step<LinkStage>(900, 'Tap Try again', () => clicks(RETRY)),
      step<LinkStage>(800, 'The watch delivers', ({ link }) =>
        feed(link, [opened(), caughtUp(50)]),
      ),
    ],
  }),
  chatStory({
    slug: 'show-earlier-loads',
    title: 'Show earlier, the button says it loads, then the whole session lands',
    shows: { text: SHOW_EARLIER },
    ends: { all: [{ text: 'How it began.' }, { absent: 'Loading earlier messages' }] },
    events: OMITTED_TAIL,
    timeline: [
      step<LinkStage>(500, 'Tap Show earlier', () => clicks(SHOW_EARLIER)),
      step<LinkStage>(900, 'The agent has read the whole file', (stage) =>
        Effect.andThen(watchesFor(stage, 2), feed(stage.link, [opened(), ...WHOLE_FILE])),
      ),
    ],
  }),
  chatStory({
    slug: 'resume-after-show-earlier',
    title: '/resume after Show earlier, the next session is read from its tail',
    note: 'The session that was read whole stays whole on a reconnect, and the next one offers Show earlier again.',
    shows: { text: SHOW_EARLIER },
    ends: { all: [{ text: 'Where we left off.' }, { text: SHOW_EARLIER }] },
    events: OMITTED_TAIL,
    settle: () =>
      Effect.gen(function* () {
        yield* seesText(SHOW_EARLIER)
        yield* clicks(SHOW_EARLIER)
      }),
    timeline: [
      step<LinkStage>(600, 'The whole file lands', (stage) =>
        Effect.andThen(watchesFor(stage, 2), feed(stage.link, [opened(), ...WHOLE_FILE])),
      ),
      step<LinkStage>(800, 'The pane resumes another session', ({ link }) =>
        feed(link, [opened(NEXT_SESSION)]),
      ),
      step<LinkStage>(700, 'The new watch reads its tail', (stage) =>
        Effect.andThen(
          watchesFor(stage, 3),
          feed(stage.link, [
            opened(NEXT_SESSION),
            omittedUpTo(NEXT_SESSION, TranscriptOffset.make(4096)),
            chunk(4096, 4106, [said(4096, 'Where we left off.')], NEXT_SESSION),
            caughtUp(4106, NEXT_SESSION),
          ]),
        ),
      ),
    ],
  }),
  chatStory({
    slug: 'older-agent-open',
    title: 'An agent too old for marks, the skeleton holds past its open',
    shows: { selector: '[data-slot="thread-skeleton"]' },
    ends: { text: 'The first chunk.' },
    link: OLDER_AGENT_HERD,
    timeline: [
      step<LinkStage>(500, 'The agent opens the session', ({ link }) => feed(link, [opened()])),
      step<LinkStage>(500, 'Its first chunk lands', ({ link }) =>
        feed(link, [chunk(0, 10, [said(0, 'The first chunk.')])]),
      ),
    ],
  }),
  chatStory({
    slug: 'older-agent-rejected-resume',
    title: 'A rejected resume on an agent too old for marks, the rows stay',
    shows: { text: 'Before the file shrank.' },
    ends: { all: [{ text: 'Read again.' }, { absent: 'Before the file shrank.' }] },
    link: OLDER_AGENT_HERD,
    events: [opened(), chunk(0, 10, [said(0, 'Before the file shrank.')])],
    timeline: [
      step<LinkStage>(500, 'The hub refuses the resume', ({ link }) =>
        link.endTranscript(CHAT_SOURCE, RESUME_REJECTED),
      ),
      step<LinkStage>(300, 'The agent opens the file again', ({ link }) => feed(link, [opened()])),
      step<LinkStage>(500, 'Its first chunk lands', ({ link }) =>
        feed(link, [chunk(0, 5, [said(0, 'Read again.')])]),
      ),
    ],
  }),
  browserStory({
    slug: 'reopen-while-dialing',
    title: 'A chat reopened while the link dials, its cache and no word yet',
    shows: { text: CHAT_TITLE },
    ends: { all: [{ text: 'Written while the socket was down.' }, { selector: CURRENT_THREAD }] },
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
        yield* goesBackToTheHerd
      }),
    timeline: [
      step<BrowserStage>(300, 'The phone puts crook away', ({ browser }) =>
        SubscriptionRef.set(browser.visible, false),
      ),
      step<BrowserStage>(300, 'crook comes back', ({ browser }) =>
        SubscriptionRef.set(browser.visible, true),
      ),
      step<BrowserStage>(0, 'The link dials', takeSession),
      step<BrowserStage>(100, 'Tap the card, the cache shows and nothing is read yet', () =>
        clicks(CARD_BUTTON),
      ),
      step<BrowserStage>(400, 'The hub answers', (stage) =>
        Effect.flatMap(currentSession(stage), (session) => Queue.offer(session.views, chatHerd())),
      ),
      step<BrowserStage>(300, 'The transcript resumes', (stage) =>
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
    slug: 'machine-gone',
    title: "A machine that does not come back, the card takes the composer's place",
    shows: { selector: SEND_READY },
    ends: { text: 'laptop is offline' },
    events: CONVERSATION,
    settle: () => types(COMPOSER, 'Half a thought'),
    timeline: [
      step<LinkStage>(600, 'The machine starts reconnecting', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgent(), 'reconnecting'))),
      ),
      step<LinkStage>(1500, 'The hub gives it up', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgent(), 'offline'))),
      ),
    ],
  }),
  chatStory({
    slug: 'machine-back-after-hub-restart',
    title: 'A hub restart, the machine reads offline until its agent attaches again',
    note: 'A hub that restarts lists a machine offline with no reconnecting first, so the phone gives it the grace itself.',
    shows: { selector: SEND_READY },
    ends: { selector: SEND_READY },
    events: CONVERSATION,
    settle: () => types(COMPOSER, 'Half a thought'),
    timeline: [
      step<LinkStage>(600, 'The restarted hub lists the machine offline', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgent(), 'offline'))),
      ),
      step<LinkStage>(1500, 'Its agent attaches', ({ link }) =>
        SubscriptionRef.set(link.state, IDLE_HERD),
      ),
    ],
  }),
  browserStory({
    slug: 'send-through-machine-redial',
    title: 'Send while the machine reconnects, held until it is back',
    note: 'The real link holds the send while the herd says the machine is not online.',
    shows: { selector: SEND_READY },
    ends: { text: HELD_PROMPT },
    path: CHAT_PATH,
    cached: Option.none(),
    settle: (stage) =>
      Effect.gen(function* () {
        yield* takeSession(stage)
        const session = yield* currentSession(stage)

        yield* Ref.set(
          stage.browser.commandAnswer,
          Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: HELD_PROMPT }))),
        )
        yield* Queue.offer(session.views, chatHerd())

        const transcript = yield* Queue.take(session.transcripts)

        yield* Queue.offerAll(transcript, CONVERSATION)
        yield* seesText('The quiet redial')
        yield* types(COMPOSER, HELD_PROMPT)
      }),
    timeline: [
      step<BrowserStage>(600, 'The machine starts reconnecting', (stage) =>
        Effect.flatMap(currentSession(stage), (session) =>
          Queue.offer(session.views, chatHerd(chatAgent(), 'reconnecting')),
        ),
      ),
      step<BrowserStage>(200, 'Tap Send while it is away', () => clicks(SEND)),
      step<BrowserStage>(700, 'The machine is back, and the held send goes out', (stage) =>
        Effect.flatMap(currentSession(stage), (session) => Queue.offer(session.views, chatHerd())),
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
    shows: { text: CHAT_TITLE },
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
    shows: { text: CHAT_TITLE },
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
