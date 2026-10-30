import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'

import type { Subagent } from '@crook/domain/Subagent'
import { TextBlock } from '@crook/domain/TranscriptMessage'
import { SubagentLaunch } from '@crook/domain/TranscriptMessage'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import {
  ChatItem,
  chatItems,
  lastTurnEvidence,
  runningCount,
  toolSummary,
  toolTitle,
} from '@crook/web/chat/ChatItems'
import type { AgentActivity, ChatContext } from '@crook/web/chat/ChatItems'
import { TranscriptLine } from '@crook/web/chat/TranscriptState'

import {
  answered,
  at,
  calledTool,
  compactBoundary,
  compactSummary,
  CWD,
  interrupted,
  notification,
  NEXT_SESSION,
  prompt,
  REVIEWER,
  said,
  SESSION,
  subagent,
  toolResult,
  toolUse,
  turnDuration,
  user,
} from '../TranscriptFixtures.ts'

const linesOf = (messages: readonly TranscriptMessage[]) =>
  Arr.map(messages, (message) => TranscriptLine.Message({ session: SESSION, message }))

const context = (
  activity: AgentActivity = 'working',
  subagents: readonly Subagent[] = [],
): ChatContext => ({
  cwd: CWD,
  activity,
  rosters: HashMap.make([SESSION, subagents]),
})

const describeItem = (item: ChatItem): string =>
  ChatItem.$match(item, {
    UserPrompt: (prompted) => `you: ${prompted.text}`,
    AssistantText: (text) => `claude: ${text.text}`,
    Tool: (tool) => `${toolTitle(tool.call)} ${tool.call.status}`,
    Subagents: (subagents) =>
      `subagents: ${subagents.runs.map((run) => `${run.description} ${run.status}`).join(', ')}`,
    Plan: (plan) => `plan: ${plan.steps.map((step) => step.status).join(' ')}`,
    Note: (note) => `note: ${note.text}`,
    Compacted: (compacted) => `compacted: ${Option.getOrElse(compacted.summary, () => '')}`,
    Cleared: () => 'cleared',
    Omitted: (omitted) => `omitted ${omitted.byteLength}`,
    Unreadable: (unreadable) => `unreadable ${unreadable.byteLength}`,
  })

const shown = (messages: readonly TranscriptMessage[], chat = context()) =>
  chatItems(linesOf(messages), chat).map(describeItem)

const reviewerInput = {
  description: 'Review the herd diff',
  prompt: 'Review it',
  subagent_type: 'code-reviewer',
  run_in_background: true,
}

describe('chatItems', () => {
  it('shows prompts, answers and tool calls titled like the terminal', () => {
    expect(
      shown([
        prompt(0, 'Read the herd'),
        toolUse(10, 'toolu_1', 'Read', { file_path: `${CWD}/packages/hub/src/Herd.ts` }),
        toolResult(20, 'toolu_1', 'export const herd = 1'),
        toolUse(30, 'toolu_2', 'Bash', {
          command: 'bun run test\nbun run lint',
          description: 'Run the tests',
        }),
        said(40, 'Done.'),
      ]),
    ).toEqual([
      'you: Read the herd',
      'Read(packages/hub/src/Herd.ts) success',
      'Bash(bun run test) running',
      'claude: Done.',
    ])
  })

  it('hides meta entries such as the local command caveat', () => {
    expect(
      shown([
        user(0, [new TextBlock({ text: '<local-command-caveat>Caveat</local-command-caveat>' })], {
          isMeta: true,
        }),
        prompt(10, 'hello'),
      ]),
    ).toEqual(['you: hello'])
  })

  it('reads a call with no result as stopped once a later prompt started another turn', () => {
    expect(
      shown([
        prompt(0, 'go'),
        toolUse(10, 'toolu_1', 'Bash', { command: 'sleep 100' }),
        interrupted(20),
        prompt(30, 'stop that'),
      ]),
    ).toEqual(['you: go', 'Bash(sleep 100) stopped', 'note: Interrupted', 'you: stop that'])
  })

  it('reads a call waiting for an answer while the agent is blocked', () => {
    expect(
      shown(
        [prompt(0, 'edit'), toolUse(10, 'toolu_1', 'Edit', { file_path: '/etc/hosts' })],
        context('blocked'),
      ),
    ).toEqual(['you: edit', 'Edit(/etc/hosts) waiting'])
  })

  it('groups one turn of Agent calls into one tree with their status', () => {
    const items = chatItems(
      linesOf([
        prompt(0, 'review'),
        toolUse(10, 'toolu_1', 'Agent', reviewerInput),
        toolResult(20, 'toolu_1', 'Async agent launched', {
          launch: new SubagentLaunch({ subagent: REVIEWER, status: 'async_launched' }),
        }),
        toolUse(30, 'toolu_2', 'Agent', { ...reviewerInput, description: 'Check the tests' }),
        toolResult(40, 'toolu_2', 'Async agent launched'),
        notification(50, 'toolu_2', 'failed'),
      ]),
      context('still', [subagent({ toolUseId: 'toolu_1' })]),
    )

    expect(items.map(describeItem)).toEqual([
      'you: review',
      'subagents: Review the herd diff running, Check the tests failed',
    ])
    expect(runningCount(items)).toBe(1)
  })

  it('reads a finished subagent as done from its roster entry', () => {
    expect(
      shown(
        [prompt(0, 'review'), toolUse(10, 'toolu_1', 'Agent', reviewerInput)],
        context('still', [subagent({ toolUseId: 'toolu_1', status: 'completed' })]),
      ),
    ).toEqual(['you: review', 'subagents: Review the herd diff done'])
  })

  it('gives a background run no end time from its launch, only from its notification', () => {
    const runsOf = (messages: readonly TranscriptMessage[]) =>
      chatItems(
        linesOf(messages),
        context('still', [subagent({ toolUseId: 'toolu_1', status: 'completed' })]),
      ).flatMap((item) => (ChatItem.$is('Subagents')(item) ? item.runs : []))
    const launched = [
      prompt(0, 'review'),
      toolUse(10, 'toolu_1', 'Agent', reviewerInput, 1),
      toolResult(20, 'toolu_1', 'Async agent launched', {
        launch: new SubagentLaunch({ subagent: REVIEWER, status: 'async_launched' }),
        seconds: 2,
      }),
    ]

    expect(runsOf(launched).map((run) => [run.status, run.finishedAt])).toEqual([
      ['done', Option.none()],
    ])
    expect(
      runsOf([...launched, notification(30, 'toolu_1', 'completed')]).map((run) =>
        Option.isSome(run.finishedAt),
      ),
    ).toEqual([true])
  })

  it('keeps one plan per turn with its latest steps', () => {
    expect(
      shown([
        prompt(0, 'plan'),
        toolUse(10, 'toolu_1', 'TodoWrite', {
          todos: [{ content: 'a', status: 'in_progress', activeForm: 'A' }],
        }),
        toolUse(20, 'toolu_2', 'TodoWrite', {
          todos: [{ content: 'a', status: 'completed', activeForm: 'A' }],
        }),
      ]),
    ).toEqual(['you: plan', 'plan: completed'])
  })

  it('shows a compaction as one divider holding its summary', () => {
    expect(
      shown([prompt(0, 'go'), compactBoundary(10), compactSummary(20, 'We built the herd.')]),
    ).toEqual(['you: go', 'compacted: We built the herd.'])
  })

  it('shows a cleared conversation as a divider', () => {
    const lines = [
      ...linesOf([prompt(0, 'old')]),
      TranscriptLine.SessionCleared({ session: NEXT_SESSION }),
      TranscriptLine.Message({ session: NEXT_SESSION, message: prompt(0, 'new') }),
    ]

    expect(chatItems(lines, context()).map(describeItem)).toEqual([
      'you: old',
      'cleared',
      'you: new',
    ])
  })

  it('keys every item by session, offset and block so a resumed watch keeps them', () => {
    const keys = chatItems(linesOf([prompt(0, 'a'), said(10, 'b')]), context()).map(
      (item) => item.key,
    )

    expect(new Set(keys).size).toBe(2)
  })
})

describe('lastTurnEvidence', () => {
  const evidence = (messages: readonly TranscriptMessage[]) =>
    Option.map(lastTurnEvidence(linesOf(messages)), (found) => ({ ends: found.ends, at: found.at }))

  it('reads a turn as over once Claude answers with a stop reason other than a tool call', () => {
    expect(evidence([prompt(0, 'Fix it'), answered(10, 'Fixed', 5)])).toStrictEqual(
      Option.some({ ends: true, at: at(5) }),
    )
  })

  it('reads a turn as still going after a prompt, a tool call or its result', () => {
    expect(evidence([prompt(0, 'Fix it')])).toMatchObject(Option.some({ ends: false }))
    expect(evidence([prompt(0, 'Fix it'), calledTool(10, 'toolu_1')])).toMatchObject(
      Option.some({ ends: false }),
    )
    expect(
      evidence([prompt(0, 'Fix it'), calledTool(10, 'toolu_1'), toolResult(20, 'toolu_1', 'ok')]),
    ).toMatchObject(Option.some({ ends: false }))
  })

  it('reads an interruption and the turn duration Claude writes last as the end of a turn', () => {
    expect(evidence([prompt(0, 'Fix it'), interrupted(10)])).toMatchObject(
      Option.some({ ends: true }),
    )
    expect(evidence([prompt(0, 'Fix it'), said(10, 'Fixed'), turnDuration(20, 7)])).toStrictEqual(
      Option.some({ ends: true, at: at(7) }),
    )
  })

  it('looks past entries that say nothing about the turn, and finds nothing in an empty transcript', () => {
    expect(
      evidence([
        prompt(0, 'Fix it'),
        answered(10, 'Fixed', 3),
        user(20, [new TextBlock({ text: 'caveat' })], { isMeta: true }),
        compactBoundary(30),
      ]),
    ).toStrictEqual(Option.some({ ends: true, at: at(3) }))
    expect(evidence([])).toStrictEqual(Option.none())
  })
})

describe('toolSummary', () => {
  it('names a file relative to the agent folder and keeps one line of a command', () => {
    expect(toolSummary('Write', { file_path: `${CWD}/a.ts` }, CWD)).toEqual(Option.some('a.ts'))
    expect(toolSummary('Bash', { command: 'ls\npwd' }, CWD)).toEqual(Option.some('ls'))
    expect(toolSummary('mcp__codemode__run', { code: 'return 1' }, CWD)).toEqual(
      Option.some('return 1'),
    )
    expect(toolSummary('ExitPlanMode', {}, CWD)).toEqual(Option.none())
  })
})
