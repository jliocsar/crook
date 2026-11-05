import * as DateTime from 'effect/DateTime'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { AgentRow } from '@crook/domain/AgentRow'

import { liveWith } from '../../test/AppWiring.tsx'
import { START } from '../../test/HerdFixtures.ts'
import {
  answered,
  chunk,
  compactBoundary,
  compactSummary,
  prompt,
  toolResult,
  toolUse,
} from '../../test/TranscriptFixtures.ts'
import { chatHerd, chatStory } from '../ChatFixtures.ts'
import { chatAgent, CONVERSATION, feed } from '../Fixtures.ts'
import { CLOCK_AFTER_START_SECONDS } from '../StoryEnv.ts'
import { step } from '../Story.tsx'
import type { LinkStage, StoryMaker } from '../Story.tsx'

const STILL_ACTIVITY = '[data-machine="activity"][data-state="Still"]'
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

const TURN_WITH_TOOLS = (
  [
    ['toolu_grep', 'Grep', { pattern: 'toast' }, 'src/toast/Toast.tsx:24'],
    ['toolu_read', 'Read', { file_path: 'src/toast/Toast.tsx' }, 'export function Toast() {}'],
    ['toolu_test', 'Bash', { command: 'bun run test' }, '42 passed'],
  ] as const
).flatMap(([id, name, input, result], index) => {
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

export const TURN_STORIES: readonly StoryMaker[] = [
  chatStory({
    slug: 'turn-with-tools',
    title: 'A turn of three tool calls and an answer',
    shows: { text: 'The quiet redial' },
    ends: { all: [{ text: 'The three checks agree.' }, { selector: STILL_ACTIVITY }] },
    events: CONVERSATION,
    timeline: [
      step<LinkStage>(400, 'herdr says working', ({ link }) =>
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
      step<LinkStage>(400, 'herdr says working', ({ link }) =>
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
      step<LinkStage>(400, 'The typed command reaches the transcript', ({ link }) =>
        feed(link, [chunk(50, 60, [prompt(50, '/compact', TURN_START)])]),
      ),
      step<LinkStage>(500, 'herdr says working', ({ link }) =>
        SubscriptionRef.set(link.state, WORKING_HERD),
      ),
      step<LinkStage>(900, 'The compaction lands', ({ link }) =>
        feed(link, [
          chunk(60, 80, [
            compactBoundary(60, TURN_START + 8),
            compactSummary(70, 'We were checking the toast.'),
          ]),
        ]),
      ),
      step<LinkStage>(300, 'herdr says idle', ({ link }) =>
        SubscriptionRef.set(link.state, IDLE_HERD),
      ),
    ],
  }),
]
