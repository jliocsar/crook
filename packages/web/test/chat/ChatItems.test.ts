import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'

import type { Subagent } from '@crook/domain/Subagent'
import type { TranscriptEvent } from '@crook/domain/Transcript'
import { TranscriptOffset } from '@crook/domain/Ids'
import {
  LocalCommandBlock,
  LocalCommandOutputBlock,
  OmittedLines,
  SubagentLaunch,
  TextBlock,
} from '@crook/domain/TranscriptMessage'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import {
  ChatItem,
  chatItems,
  runningCount,
  toolSummary,
  toolTitle,
} from '@crook/web/chat/ChatItems'
import type { AgentActivity, ChatContext } from '@crook/web/chat/ChatItems'
import { applyTranscriptEvent, EMPTY_TRANSCRIPT } from '@crook/web/chat/TranscriptState'
import type { TranscriptLine } from '@crook/web/chat/TranscriptState'
import {
  activityEventOf,
  activityMachine,
  working,
  lastTurnEvidence,
  still,
} from '@crook/web/chat/ActivityMachine'
import { PANE_LIVE } from '@crook/web/chat/PresenceMachine'

import {
  answered,
  at,
  calledTool,
  chunk,
  compactBoundary,
  compactSummary,
  CWD,
  interrupted,
  notification,
  NEXT_SESSION,
  opened,
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
import { agent } from '../HerdFixtures.ts'

const fold = (events: readonly TranscriptEvent[]) =>
  Arr.reduce(events, EMPTY_TRANSCRIPT, applyTranscriptEvent)

const linesOf = (messages: readonly TranscriptMessage[]): readonly TranscriptLine[] =>
  Arr.map(messages, (message) => ({ session: SESSION, message }))

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

  it('shows /clear as one divider, from what the new session writes first', () => {
    expect(
      shown([
        user(0, [new TextBlock({ text: 'caveat' })], { isMeta: true }),
        user(10, [new LocalCommandBlock({ name: '/clear', args: '' })]),
        user(20, [new LocalCommandOutputBlock({ text: '' })]),
        prompt(30, 'new'),
      ]),
    ).toEqual(['cleared', 'you: new'])
  })

  it('shows no divider for a session the pane resumed, which writes no command', () => {
    const resumed = fold([
      opened(),
      chunk(0, 10, [prompt(0, 'old')]),
      opened(NEXT_SESSION),
      chunk(0, 10, [prompt(0, 'resumed'), said(5, 'where we were')], NEXT_SESSION),
    ])

    expect(chatItems(resumed.lines, context()).map(describeItem)).toEqual([
      'you: resumed',
      'claude: where we were',
    ])
  })

  it('keys no row twice when the pane goes to another session and back', () => {
    const back = fold([
      opened(),
      chunk(0, 10, [prompt(0, 'first')]),
      opened(NEXT_SESSION),
      chunk(0, 10, [prompt(0, 'second')], NEXT_SESSION),
      opened(),
      chunk(0, 10, [prompt(0, 'first')]),
    ])
    const keys = chatItems(back.lines, context()).map((item) => item.key)

    expect(keys).toHaveLength(1)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('holds no Working row across /clear over a turn the old session left open', () => {
    const before = fold([opened(), chunk(0, 10, [prompt(0, 'unanswered')])])
    const after = applyTranscriptEvent(before, opened(NEXT_SESSION))
    const since = Option.getOrThrow(at(0))
    const idleRow = Option.some(agent('w1:p1', 'idle'))
    const stepOver = (lines: Parameters<typeof lastTurnEvidence>[0]) =>
      activityMachine.transition(
        working(since),
        activityEventOf(PANE_LIVE, idleRow, lastTurnEvidence(lines)),
      )[0]

    expect(stepOver(before.lines)).toEqual(working(since))
    expect(stepOver(after.lines)).toEqual(still('idle'))
  })

  it('keys every item by session, offset and block so a resumed watch keeps them', () => {
    const keys = chatItems(linesOf([prompt(0, 'a'), said(10, 'b')]), context()).map(
      (item) => item.key,
    )

    expect(new Set(keys).size).toBe(2)
  })
})

describe('a hole in the thread', () => {
  const hole = new OmittedLines({ offset: TranscriptOffset.make(40), byteLength: 4056 })

  it('ends the calls above it, whose results it may hold', () => {
    const items = chatItems(
      linesOf([
        prompt(0, 'Read it'),
        toolUse(10, 'toolu_read', 'Read', { file_path: `${CWD}/a.ts` }),
        hole,
        said(4096, 'Still going.'),
      ]),
      context('working'),
    )

    expect(Arr.map(items, describeItem)).toEqual([
      'you: Read it',
      'Read(a.ts) stopped',
      'omitted 4056',
      'claude: Still going.',
    ])
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
        compactSummary(30, 'We fixed it.'),
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
