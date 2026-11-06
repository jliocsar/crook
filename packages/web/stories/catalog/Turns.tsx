import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { AgentRow } from '@crook/domain/AgentRow'
import {
  LocalCommandBlock,
  LocalCommandOutputBlock,
  TextBlock,
} from '@crook/domain/TranscriptMessage'
import { COMMAND_SILENCE } from '@crook/web/chat/ChatCommands'

import { liveWith } from '../../test/AppWiring.tsx'
import { START } from '../../test/HerdFixtures.ts'
import {
  answered,
  caughtUp,
  chunk,
  compactBoundary,
  compactSummary,
  opened,
  prompt,
  toolResult,
  toolUse,
  user,
} from '../../test/TranscriptFixtures.ts'
import { chatHerd, chatStory, delivered } from '../ChatFixtures.ts'
import { chatAgent, chatAgentSaying, CONVERSATION, feed } from '../Fixtures.ts'
import { MANY_LINES_END, manyLinesChunk } from '../ManyLines.ts'
import { clicks, seesText, seesWithin, types } from '../StageDom.ts'
import { CLOCK_AFTER_START_SECONDS } from '../StoryEnv.ts'
import { step } from '../Story.tsx'
import type { LinkStage, StoryMaker } from '../Story.tsx'

const STILL_ACTIVITY = '[data-machine="activity"][data-state="Still"]'
const COMPOSER_FIELD_NAME = /Message/u
const TYPED_COMPACT = '/compact keep the toast'
const UNANSWERED_FIND_MS = Duration.toMillis(COMMAND_SILENCE) + 2000
const BLIP_ANSWER_MS = 100
const BLIP_LET_GO_MS = 117
const FLIPS_WORKING_AT = DateTime.add(START, { seconds: CLOCK_AFTER_START_SECONDS })
const FLIPS_IDLE_AT = DateTime.add(FLIPS_WORKING_AT, { seconds: 10 })

export const QUESTION = 'Now check the toast too'

export const WORKING_HERD = liveWith(
  chatHerd(
    new AgentRow(
      Struct.evolve(chatAgent('working', 0), { statusChangedAt: () => FLIPS_WORKING_AT }),
    ),
  ),
)
export const IDLE_HERD = liveWith(
  chatHerd(
    new AgentRow(Struct.evolve(chatAgent('idle', 0), { statusChangedAt: () => FLIPS_IDLE_AT })),
  ),
)

const TURN_START = CLOCK_AFTER_START_SECONDS + 1

const TOOL_CALLS = [
  ['toolu_grep', 'Grep', { pattern: 'toast' }, 'src/toast/Toast.tsx:24'],
  ['toolu_read', 'Read', { file_path: 'src/toast/Toast.tsx' }, 'export function Toast() {}'],
  ['toolu_test', 'Bash', { command: 'bun run test' }, '42 passed'],
] as const

const TURN_WITH_TOOLS = Arr.flatMap(TOOL_CALLS, ([id, name, input, result], index) => {
  const start = 60 + index * 20
  const seconds = TURN_START + 1 + index * 2

  return [
    step<LinkStage>(index === 0 ? 900 : 300, `${name} starts`, ({ link }) =>
      feed(link, [chunk(start, start + 10, [toolUse(start, id, name, input, seconds)])]),
    ),
    step<LinkStage>(800, `${name} ends`, ({ link }) =>
      feed(link, [
        chunk(start + 10, start + 20, [
          toolResult(start + 10, id, result, { seconds: seconds + 1 }),
        ]),
      ]),
    ),
  ]
})

const sends = (text: string) => (stage: LinkStage) =>
  Effect.gen(function* () {
    yield* delivered(stage, text)
    yield* types(COMPOSER_FIELD_NAME, text)
    yield* clicks('Send')
  })

export const TURN_STORIES: readonly StoryMaker[] = [
  chatStory({
    slug: 'turn-with-tools',
    title: 'A turn of three tool calls and an answer',
    shows: { text: 'The quiet redial' },
    ends: { all: [{ text: 'The three checks agree.' }, { selector: STILL_ACTIVITY }] },
    events: CONVERSATION,
    timeline: [
      step<LinkStage>(900, 'herdr says working', ({ link }) =>
        SubscriptionRef.set(link.state, WORKING_HERD),
      ),
      step<LinkStage>(500, 'The prompt reaches the transcript', ({ link }) =>
        feed(link, [chunk(50, 60, [prompt(50, QUESTION, TURN_START)])]),
      ),
      ...TURN_WITH_TOOLS,
      step<LinkStage>(1200, 'The answer lands', ({ link }) =>
        feed(link, [chunk(120, 130, [answered(120, 'The three checks agree.', TURN_START + 8)])]),
      ),
      step<LinkStage>(150, 'herdr says idle', ({ link }) =>
        SubscriptionRef.set(link.state, IDLE_HERD),
      ),
    ],
  }),
  chatStory({
    slug: 'idle-before-answer',
    title: 'herdr goes idle before the answer lands',
    shows: { text: 'The quiet redial' },
    ends: { all: [{ text: 'Idle came first, the answer after.' }, { selector: STILL_ACTIVITY }] },
    events: CONVERSATION,
    timeline: [
      step<LinkStage>(900, 'herdr says working', ({ link }) =>
        SubscriptionRef.set(link.state, WORKING_HERD),
      ),
      step<LinkStage>(500, 'The prompt reaches the transcript', ({ link }) =>
        feed(link, [chunk(50, 60, [prompt(50, QUESTION, TURN_START)])]),
      ),
      step<LinkStage>(900, 'herdr says idle, the turn still open', ({ link }) =>
        SubscriptionRef.set(link.state, IDLE_HERD),
      ),
      step<LinkStage>(900, 'The answer lands', ({ link }) =>
        feed(link, [
          chunk(60, 70, [answered(60, 'Idle came first, the answer after.', TURN_START + 12)]),
        ]),
      ),
    ],
  }),
  chatStory({
    slug: 'compact-ends-the-turn',
    title: 'A typed /compact, working while it runs, and nothing after',
    shows: { text: 'The quiet redial' },
    ends: {
      all: [
        { text: 'Conversation compacted' },
        { absent: 'Working' },
        { selector: STILL_ACTIVITY },
      ],
    },
    events: CONVERSATION,
    timeline: [
      step<LinkStage>(300, 'The user sends /compact', sends(TYPED_COMPACT)),
      step<LinkStage>(400, 'The typed command reaches the transcript as meta', ({ link }) =>
        feed(link, [
          chunk(50, 60, [
            user(50, [new TextBlock({ text: TYPED_COMPACT })], {
              isMeta: true,
              seconds: TURN_START,
            }),
          ]),
        ]),
      ),
      step<LinkStage>(500, 'herdr says working', ({ link }) =>
        SubscriptionRef.set(link.state, WORKING_HERD),
      ),
      step<LinkStage>(900, 'The compaction lands', ({ link }) =>
        feed(link, [
          chunk(60, 100, [
            compactBoundary(60, TURN_START + 8),
            compactSummary(70, 'We were checking the toast.'),
            user(80, [new TextBlock({ text: 'caveat' })], {
              isMeta: true,
              seconds: TURN_START + 8,
            }),
            user(85, [new LocalCommandBlock({ name: '/compact', args: 'keep the toast' })], {
              seconds: TURN_START + 8,
            }),
            user(
              90,
              [new LocalCommandOutputBlock({ text: 'Compacted (ctrl+o to see full summary)' })],
              {
                seconds: TURN_START + 8,
              },
            ),
          ]),
        ]),
      ),
      step<LinkStage>(300, 'herdr says idle', ({ link }) =>
        SubscriptionRef.set(link.state, IDLE_HERD),
      ),
    ],
  }),
  chatStory({
    slug: 'slash-send-lands',
    title: 'A slash send reads Sent, then its command and output land in its place',
    shows: { text: 'The quiet redial' },
    ends: {
      all: [
        { selector: '[data-slot="command"] code' },
        { absent: 'Sent' },
        { selector: STILL_ACTIVITY },
      ],
    },
    events: CONVERSATION,
    timeline: [
      step<LinkStage>(600, 'The user sends /model opus', sends('/model opus')),
      step<LinkStage>(700, 'The command line lands', ({ link }) =>
        feed(link, [
          chunk(50, 60, [
            user(50, [new LocalCommandBlock({ name: '/model', args: 'opus' })], {
              seconds: TURN_START,
            }),
          ]),
        ]),
      ),
      step<LinkStage>(700, 'Its output lands in a later batch', ({ link }) =>
        feed(link, [
          chunk(60, 70, [
            user(
              60,
              [
                new LocalCommandOutputBlock({
                  text: 'Set model to `Opus 5.5` and saved as your default for new sessions',
                }),
              ],
              { seconds: TURN_START },
            ),
          ]),
        ]),
      ),
    ],
  }),
  chatStory({
    slug: 'slash-send-following',
    title: 'A slash send at the end of a long thread, its output lifting the thread as it lands',
    shows: { text: 'Line 119' },
    ends: {
      all: [
        { selector: '[data-slot="command"] code' },
        { absent: 'Sent' },
        { selector: STILL_ACTIVITY },
      ],
    },
    events: [opened(), manyLinesChunk(0), caughtUp(MANY_LINES_END)],
    timeline: [
      step<LinkStage>(600, 'The user sends /model opus', sends('/model opus')),
      step<LinkStage>(700, 'The command line lands', ({ link }) =>
        feed(link, [
          chunk(MANY_LINES_END, MANY_LINES_END + 10, [
            user(MANY_LINES_END, [new LocalCommandBlock({ name: '/model', args: 'opus' })], {
              seconds: TURN_START,
            }),
          ]),
        ]),
      ),
      step<LinkStage>(700, 'Its output lands in a later batch', ({ link }) =>
        feed(link, [
          chunk(MANY_LINES_END + 10, MANY_LINES_END + 20, [
            user(
              MANY_LINES_END + 10,
              [
                new LocalCommandOutputBlock({
                  text: 'Set model to `Opus 5.5` and saved as your default for new sessions',
                }),
              ],
              { seconds: TURN_START },
            ),
          ]),
        ]),
      ),
    ],
  }),
  chatStory({
    slug: 'slash-send-following-one-write',
    title: 'A slash send at the end of a long thread, its command and output landing in one write',
    shows: { text: 'Line 119' },
    ends: {
      all: [
        { selector: '[data-slot="command"] code' },
        { absent: 'Sent' },
        { selector: STILL_ACTIVITY },
      ],
    },
    events: [opened(), manyLinesChunk(0), caughtUp(MANY_LINES_END)],
    timeline: [
      step<LinkStage>(600, 'The user sends /model opus', sends('/model opus')),
      step<LinkStage>(700, 'The command and its output land in one write', ({ link }) =>
        feed(link, [
          chunk(MANY_LINES_END, MANY_LINES_END + 20, [
            user(MANY_LINES_END, [new LocalCommandBlock({ name: '/model', args: 'opus' })], {
              seconds: TURN_START,
            }),
            user(
              MANY_LINES_END + 10,
              [
                new LocalCommandOutputBlock({
                  text: 'Set model to `Opus 5.5` and saved as your default for new sessions',
                }),
              ],
              { seconds: TURN_START },
            ),
          ]),
        ]),
      ),
    ],
  }),
  chatStory({
    slug: 'slash-send-opens-a-dialog',
    title: 'A slash send that opens a dialog says so a second after the row does, until it closes',
    shows: { text: 'The quiet redial' },
    ends: {
      all: [
        { absent: 'No answer to /model sonnet' },
        { absent: 'Sent' },
        { selector: STILL_ACTIVITY },
      ],
    },
    row: chatAgentSaying(false),
    events: CONVERSATION,
    timeline: [
      step<LinkStage>(600, 'The user sends a command that opens a dialog', sends('/model sonnet')),
      step<LinkStage>(220, 'The row says Claude waits on the laptop', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgentSaying(true)))),
      ),
      step<LinkStage>(0, 'The row has said it for a second', () =>
        seesText('No answer to /model sonnet'),
      ),
      step<LinkStage>(1500, 'The dialog closes on the laptop', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgentSaying(false)))),
      ),
    ],
  }),
  chatStory({
    slug: 'slash-send-waiting-blip',
    title: 'A slash send whose command reads as waiting for a moment shows no note on its way',
    shows: { text: 'The quiet redial' },
    ends: {
      all: [{ text: 'Effort level: auto' }, { absent: 'No answer to' }, { absent: 'Sent' }],
    },
    row: chatAgentSaying(false),
    events: CONVERSATION,
    timeline: [
      step<LinkStage>(
        600,
        'The user sends a command that answers at once',
        sends('/effort status'),
      ),
      step<LinkStage>(
        220,
        'The row says Claude waits, for as long as the command takes',
        ({ link }) => SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgentSaying(true)))),
      ),
      step<LinkStage>(BLIP_ANSWER_MS, 'The command and its output land', ({ link }) =>
        feed(link, [
          chunk(50, 70, [
            user(50, [new LocalCommandBlock({ name: '/effort', args: 'status' })], {
              seconds: TURN_START,
            }),
            user(60, [new LocalCommandOutputBlock({ text: 'Effort level: auto' })], {
              seconds: TURN_START,
            }),
          ]),
        ]),
      ),
      step<LinkStage>(BLIP_LET_GO_MS, 'The row lets go', ({ link }) =>
        SubscriptionRef.set(link.state, liveWith(chatHerd(chatAgentSaying(false)))),
      ),
    ],
  }),
  chatStory({
    slug: 'slash-send-silent',
    title: 'A slash send nothing answers ends its Sent row and says why it may be quiet',
    shows: { text: 'The quiet redial' },
    ends: {
      all: [{ text: 'No answer to /login' }, { absent: 'Sent' }, { selector: STILL_ACTIVITY }],
    },
    events: CONVERSATION,
    timeline: [
      step<LinkStage>(600, 'The user sends a command that opens a dialog', sends('/login')),
      step<LinkStage>(600, 'The Sent row holds', () => seesText('Sent')),
      step<LinkStage>(0, 'Nothing lands until the row gives up', () =>
        seesWithin(UNANSWERED_FIND_MS, { text: 'No answer to /login' }),
      ),
    ],
  }),
]
