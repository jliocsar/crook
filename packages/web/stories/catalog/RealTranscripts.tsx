import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'

import { caughtUp, chunk, NEXT_SESSION, opened } from '../../test/TranscriptFixtures.ts'
import { chatStory } from '../ChatFixtures.ts'
import { feed } from '../Fixtures.ts'
import { messagesOf } from '../RealTranscriptFixtures.ts'
import type { StoryMaker } from '../Story.tsx'

const REAL_LENGTH = 1_000_000
const ANY_ROW = '[data-row]'
const THREAD = '[data-slot="chat-dock"]'

const REAL_FIXTURES: readonly (readonly [string, string, () => Promise<{ default: string }>])[] = [
  ['plain-turn', 'A plain turn', () => import('@crook/claude/fixtures/plain-turn.jsonl?raw')],
  [
    'tool-use-and-result',
    'Tools and their results',
    () => import('@crook/claude/fixtures/tool-use-and-result.jsonl?raw'),
  ],
  [
    'tool-result-variants',
    'Every tool result shape',
    () => import('@crook/claude/fixtures/tool-result-variants.jsonl?raw'),
  ],
  [
    'edit-with-diff',
    'An edit with its diff',
    () => import('@crook/claude/fixtures/edit-with-diff.jsonl?raw'),
  ],
  ['image', 'An image', () => import('@crook/claude/fixtures/image.jsonl?raw')],
  ['thinking', 'Thinking blocks', () => import('@crook/claude/fixtures/thinking.jsonl?raw')],
  [
    'compaction-auto',
    'An automatic compaction',
    () => import('@crook/claude/fixtures/compaction-auto.jsonl?raw'),
  ],
  [
    'compaction-manual',
    'A manual compaction',
    () => import('@crook/claude/fixtures/compaction-manual.jsonl?raw'),
  ],
  ['odd-entries', 'Odd entries', () => import('@crook/claude/fixtures/odd-entries.jsonl?raw')],
  [
    'unknown-future-entry',
    'An entry from a future Claude',
    () => import('@crook/claude/fixtures/unknown-future-entry.jsonl?raw'),
  ],
  [
    'torn-mid-file',
    'A line torn mid file',
    () => import('@crook/claude/fixtures/torn-mid-file.jsonl?raw'),
  ],
  [
    'truncated-final-line',
    'A truncated last line',
    () => import('@crook/claude/fixtures/truncated-final-line.jsonl?raw'),
  ],
  [
    'subagent-session',
    'A session that ran subagents',
    () => import('@crook/claude/fixtures/subagent/ff0f77be-1e98-4bb2-8b24-38d673361867.jsonl?raw'),
  ],
  [
    'stuck-runs',
    'Runs settled by notifications',
    () =>
      import('@crook/claude/fixtures/stuck-runs/b449ab5a-d745-4976-919d-e9bd86d161fc.jsonl?raw'),
  ],
  [
    'background-shells',
    'Background shells',
    () => import('@crook/claude/fixtures/background/shells.jsonl?raw'),
  ],
  [
    'background-plugin-monitor',
    'A plugin shell and a monitor',
    () => import('@crook/claude/fixtures/background/plugin-shell-and-monitor.jsonl?raw'),
  ],
]

const WITHOUT_ROWS: readonly string[] = ['thinking', 'unknown-future-entry', 'stuck-runs']

const realStory = ([slug, title, load]: (typeof REAL_FIXTURES)[number]) =>
  chatStory({
    slug,
    title: `Real transcript, ${title}`,
    arrange: ({ link }) =>
      Effect.flatMap(Effect.promise(load), ({ default: jsonl }) =>
        feed(link, [opened(), chunk(0, REAL_LENGTH, messagesOf(jsonl)), caughtUp(REAL_LENGTH)]),
      ),
    shows: { selector: WITHOUT_ROWS.includes(slug) ? THREAD : ANY_ROW },
  })

export const REAL_TRANSCRIPT_STORIES: readonly StoryMaker[] = [
  ...Arr.map(REAL_FIXTURES, realStory),
  chatStory({
    slug: 'clear-across-sessions',
    title: 'Real transcript, across a /clear',
    arrange: ({ link }) =>
      Effect.gen(function* () {
        const { default: oldTail } = yield* Effect.promise(
          () => import('@crook/claude/fixtures/clear-old-session-tail.jsonl?raw'),
        )
        const { default: fresh } = yield* Effect.promise(
          () => import('@crook/claude/fixtures/clear-new-session.jsonl?raw'),
        )

        yield* feed(link, [
          opened(),
          chunk(0, REAL_LENGTH, messagesOf(oldTail)),
          opened(NEXT_SESSION),
          chunk(0, REAL_LENGTH, messagesOf(fresh), NEXT_SESSION),
          caughtUp(REAL_LENGTH, NEXT_SESSION),
        ])
      }),
    shows: { all: [{ text: 'Conversation cleared' }, { absent: '/clear' }] },
  }),
]
