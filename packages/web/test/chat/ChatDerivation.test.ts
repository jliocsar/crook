import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'

import { parseLine } from '@crook/claude/TranscriptParser'
import clearNewSession from '@crook/claude/fixtures/clear-new-session.jsonl?raw'
import clearOldSessionTail from '@crook/claude/fixtures/clear-old-session-tail.jsonl?raw'
import compactionAuto from '@crook/claude/fixtures/compaction-auto.jsonl?raw'
import compactionManual from '@crook/claude/fixtures/compaction-manual.jsonl?raw'
import oddEntries from '@crook/claude/fixtures/odd-entries.jsonl?raw'
import plainTurn from '@crook/claude/fixtures/plain-turn.jsonl?raw'
import stuckRunNotices from '@crook/claude/fixtures/stuck-runs/b449ab5a-d745-4976-919d-e9bd86d161fc.jsonl?raw'
import subagentSession from '@crook/claude/fixtures/subagent/ff0f77be-1e98-4bb2-8b24-38d673361867.jsonl?raw'
import toolResultVariants from '@crook/claude/fixtures/tool-result-variants.jsonl?raw'
import toolUseAndResult from '@crook/claude/fixtures/tool-use-and-result.jsonl?raw'
import { TranscriptOffset } from '@crook/domain/Ids'
import type { TranscriptEvent } from '@crook/domain/Transcript'
import { SubagentLaunch } from '@crook/domain/TranscriptMessage'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import {
  type AgentActivity,
  chatItems,
  type ChatContext,
  type ChatDerivation,
  deriveChat,
  EMPTY_CHAT,
} from '@crook/web/chat/ChatItems'
import {
  applyTranscriptEvent,
  EMPTY_TRANSCRIPT,
  NO_ROSTERS,
  type SessionRosters,
  type TranscriptLine,
} from '@crook/web/chat/TranscriptState'

import {
  answered,
  chunk,
  compactBoundary,
  compactSummary,
  CWD,
  NEXT_SESSION,
  notification,
  opened,
  prompt,
  REVIEWER,
  said,
  SESSION,
  subagent,
  toolResult,
  toolUse,
} from '../TranscriptFixtures.ts'

const CHANGING_ACTIVITY: readonly AgentActivity[] = ['working', 'blocked', 'working', 'still']
const STEADY_ACTIVITY: readonly AgentActivity[] = ['working']
const BATCH_SIZES = [1, 2, 3, 5, 8]

const encoder = new TextEncoder()

const messagesOf = (jsonl: string): readonly TranscriptMessage[] =>
  pipe(
    jsonl.split('\n'),
    Arr.mapAccum(0, (offset, text): readonly [number, readonly TranscriptMessage[]] => {
      const bytes = encoder.encode(text)

      return [offset + bytes.length + 1, parseLine(bytes, TranscriptOffset.make(offset))]
    }),
    ([, parsed]) => Arr.flatten(parsed),
  )

const linesOf = (events: readonly TranscriptEvent[]): readonly TranscriptLine[] =>
  Arr.reduce(events, EMPTY_TRANSCRIPT, applyTranscriptEvent).lines

const fixtureLines = (jsonl: string): readonly TranscriptLine[] =>
  linesOf([opened(), chunk(0, 1, messagesOf(jsonl))])

const contextAt = (
  step: number,
  rosters: SessionRosters,
  activities: readonly AgentActivity[] = CHANGING_ACTIVITY,
): ChatContext => ({
  cwd: CWD,
  activity: activities[step % activities.length] ?? 'still',
  rosters,
})

const prefixEnds = (count: number, size: number): readonly number[] =>
  Arr.makeBy(Math.ceil(count / size) + 1, (step) => Math.min(step * size, count))

const derivedAlong = (
  lines: readonly TranscriptLine[],
  size: number,
  rostersAt: (step: number) => SessionRosters,
  activities: readonly AgentActivity[],
) =>
  Arr.mapAccum(
    prefixEnds(lines.length, size),
    EMPTY_CHAT,
    (previous, end, step): readonly [ChatDerivation, { full: unknown; incremental: unknown }] => {
      const prefix = lines.slice(0, end)
      const context = contextAt(step, rostersAt(step), activities)
      const next = deriveChat(previous, prefix, context)

      return [next, { full: chatItems(prefix, context), incremental: next.items }]
    },
  )[1]

const expectEqualAlong = (
  lines: readonly TranscriptLine[],
  rostersAt: (step: number) => SessionRosters = () => NO_ROSTERS,
) => {
  for (const activities of [CHANGING_ACTIVITY, STEADY_ACTIVITY]) {
    for (const size of BATCH_SIZES) {
      for (const { full, incremental } of derivedAlong(lines, size, rostersAt, activities)) {
        expect(incremental).toEqual(full)
      }
    }
  }
}

const FIXTURES = {
  'plain turn': plainTurn,
  'tool results in a later batch': toolUseAndResult,
  'tool result variants': toolResultVariants,
  'auto compaction': compactionAuto,
  'manual compaction': compactionManual,
  'odd entries': oddEntries,
  'task notifications': stuckRunNotices,
  'subagent session': subagentSession,
}

const reviewerInput = {
  description: 'Review the herd diff',
  prompt: 'Review it',
  subagent_type: 'code-reviewer',
  run_in_background: true,
}

const backgroundRun = linesOf([
  opened(),
  chunk(0, 1, [
    prompt(0, 'review'),
    toolUse(10, 'toolu_agent', 'Agent', reviewerInput, 1),
    toolUse(20, 'toolu_read', 'Read', { file_path: `${CWD}/README.md` }, 2),
    toolResult(30, 'toolu_agent', 'Async agent launched', {
      launch: new SubagentLaunch({ subagent: REVIEWER, status: 'async_launched' }),
      seconds: 3,
    }),
    said(40, 'Reading while it runs'),
    prompt(50, 'and the next thing'),
    toolResult(60, 'toolu_read', 'late contents', { seconds: 5 }),
    compactBoundary(70),
    compactSummary(80, 'Summary of the work so far'),
    notification(90, 'toolu_agent', 'completed'),
  ]),
  opened(NEXT_SESSION),
  chunk(0, 1, [prompt(0, 'after the clear'), answered(10, 'fresh start')], NEXT_SESSION),
])

describe('deriveChat', () => {
  for (const [name, jsonl] of Object.entries(FIXTURES)) {
    it(`equals a full recompute at every batch of ${name}`, () => {
      expectEqualAlong(fixtureLines(jsonl))
    })
  }

  it('equals a full recompute across a /clear into the next session', () => {
    expectEqualAlong(
      linesOf([
        opened(),
        chunk(0, 1, messagesOf(clearOldSessionTail)),
        opened(NEXT_SESSION),
        chunk(0, 1, messagesOf(clearNewSession), NEXT_SESSION),
      ]),
    )
  })

  it('equals a full recompute while results, notices, rosters and sessions arrive late', () => {
    const rosters = HashMap.make([SESSION, [subagent({ toolUseId: 'toolu_agent' })]])
    const finished = HashMap.make([
      SESSION,
      [subagent({ toolUseId: 'toolu_agent', status: 'completed' })],
    ])

    expectEqualAlong(backgroundRun, (step) => {
      if (step < 2) {
        return NO_ROSTERS
      }

      return step < 5 ? rosters : finished
    })
  })

  it('re-derives only the item a late result lands on', () => {
    const context = contextAt(0, NO_ROSTERS)
    const before = deriveChat(EMPTY_CHAT, backgroundRun.slice(0, 6), context)
    const after = deriveChat(before, backgroundRun.slice(0, 7), context)

    expect(before.items.map((item, index) => after.items[index] === item)).toEqual([
      true,
      true,
      false,
      true,
      true,
    ])
  })

  it('answers the same derivation when nothing changed', () => {
    const context = contextAt(0, NO_ROSTERS)
    const derived = deriveChat(EMPTY_CHAT, backgroundRun, context)

    expect(deriveChat(derived, backgroundRun, context)).toBe(derived)
  })

  it('starts over when the lines are not an extension of the last ones', () => {
    const context = contextAt(0, NO_ROSTERS)
    const derived = deriveChat(EMPTY_CHAT, backgroundRun, context)
    const other = fixtureLines(plainTurn)

    expect(deriveChat(derived, other, context).items).toEqual(chatItems(other, context))
  })
})
