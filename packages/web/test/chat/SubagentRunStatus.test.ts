import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'

import type { Subagent } from '@crook/domain/Subagent'
import { SubagentsChanged, type TranscriptEvent } from '@crook/domain/Transcript'
import { SubagentLaunch } from '@crook/domain/TranscriptMessage'
import {
  type AgentActivity,
  ChatItem,
  chatItems,
  runsIn,
  type SubagentRun,
} from '@crook/web/chat/ChatItems'
import { treeRun } from '@crook/web/chat/ToolView'
import {
  applyTranscriptEvent,
  EMPTY_TRANSCRIPT,
  TranscriptLine,
  type TranscriptView,
} from '@crook/web/chat/TranscriptState'

import {
  chunk,
  CWD,
  NEXT_SESSION,
  opened,
  prompt,
  REVIEWER,
  SESSION,
  subagent,
  toolResult,
  toolUse,
} from '../TranscriptFixtures.ts'

const LAUNCH_SECONDS = 1
const MINUTE_LATER = 60

const reviewerInput = {
  description: 'Review the herd diff',
  prompt: 'Review it',
  subagent_type: 'code-reviewer',
  run_in_background: true,
}

const launched = chunk(0, 30, [
  prompt(0, 'review'),
  toolUse(10, 'toolu_1', 'Agent', reviewerInput, LAUNCH_SECONDS),
  toolResult(20, 'toolu_1', 'Async agent launched', {
    launch: new SubagentLaunch({ subagent: REVIEWER, status: 'async_launched' }),
    seconds: LAUNCH_SECONDS,
  }),
])

const rosterOf = (session: typeof SESSION, subagents: readonly Subagent[]) =>
  new SubagentsChanged({ session, subagents })

const fold = (events: readonly TranscriptEvent[]) =>
  Arr.reduce(events, EMPTY_TRANSCRIPT, applyTranscriptEvent)

const itemsOf = (view: TranscriptView, activity: AgentActivity) =>
  chatItems(view.lines, { cwd: CWD, activity, rosters: view.rosters })

const describeItem = (item: ChatItem): string =>
  ChatItem.$match(item, {
    UserPrompt: (prompted) => `you: ${prompted.text}`,
    Subagents: (subagents) =>
      `subagents: ${subagents.runs.map((run) => `${run.description} ${run.status}`).join(', ')}`,
    Cleared: () => 'cleared',
    AssistantText: () => 'text',
    Tool: () => 'tool',
    Plan: () => 'plan',
    Note: () => 'note',
    Compacted: () => 'compacted',
    Omitted: () => 'omitted',
    Unreadable: () => 'unreadable',
  })

const durationOf = (run: SubagentRun) =>
  treeRun(run, {
    now: Option.getOrThrow(
      Option.map(run.startedAt, (startedAt) => DateTime.add(startedAt, { seconds: MINUTE_LATER })),
    ),
    paneClosed: false,
    opensRuns: true,
  }).duration

describe('a background subagent run', () => {
  it('shows as done in a session the pane left while the phone was away', () => {
    const beforeAway = [opened(), launched, rosterOf(SESSION, [subagent({ toolUseId: 'toolu_1' })])]
    const onReturn = [
      rosterOf(SESSION, [subagent({ toolUseId: 'toolu_1', status: 'completed' })]),
      opened(NEXT_SESSION),
      chunk(0, 10, [prompt(0, 'next')], NEXT_SESSION),
      rosterOf(NEXT_SESSION, []),
    ]

    expect(itemsOf(fold(beforeAway), 'working').map(describeItem)).toEqual([
      'you: review',
      'subagents: Review the herd diff running',
    ])
    expect(itemsOf(fold([...beforeAway, ...onReturn]), 'working').map(describeItem)).toEqual([
      'you: review',
      'subagents: Review the herd diff done',
      'cleared',
      'you: next',
    ])
  })

  it('counts no elapsed time once its session is idle, while the agent still says running', () => {
    const view = fold([opened(), launched, rosterOf(SESSION, [subagent({ toolUseId: 'toolu_1' })])])
    const [working] = runsIn(itemsOf(view, 'working'))
    const [idle] = runsIn(itemsOf(view, 'still'))

    expect([working?.status, working?.sessionIdle]).toEqual(['running', false])
    expect(Option.map(Option.fromUndefinedOr(working), durationOf)).toEqual(Option.some('1m 0s'))
    expect([idle?.status, idle?.sessionIdle]).toEqual(['running', true])
    expect(Option.map(Option.fromUndefinedOr(idle), durationOf)).toEqual(Option.some(undefined))
  })

  it('counts no elapsed time once the pane has moved on to another session', () => {
    const view = fold([
      opened(),
      launched,
      rosterOf(SESSION, [subagent({ toolUseId: 'toolu_1' })]),
      opened(NEXT_SESSION),
    ])
    const [left] = runsIn(itemsOf(view, 'working'))

    expect(Arr.last(view.lines).pipe(Option.map(TranscriptLine.$is('SessionCleared')))).toEqual(
      Option.some(true),
    )
    expect([left?.status, left?.sessionIdle]).toEqual(['running', true])
    expect(Option.map(Option.fromUndefinedOr(left), durationOf)).toEqual(Option.some(undefined))
    expect(HashMap.has(view.rosters, SESSION)).toBe(true)
  })
})
