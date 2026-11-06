import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

import { TranscriptOffset } from '@crook/domain/Ids'
import {
  AssistantMessage,
  ImageBlock,
  LocalCommandBlock,
  LocalCommandOutputBlock,
  NoticeBlock,
  PatchHunk,
  SystemMessage,
  TextBlock,
  ThinkingBlock,
  ToolResultBlock,
  ToolUseBlock,
  UnrecognizedBlock,
} from '@crook/domain/TranscriptMessage'
import type * as Schema from 'effect/Schema'

import {
  answered,
  assistant,
  at,
  chunk,
  compactBoundary,
  compactSummary,
  CWD,
  interrupted,
  NEXT_SESSION,
  notification,
  opened,
  caughtUp,
  PIXEL_PNG,
  prompt,
  said,
  stopHookFeedback,
  subagent,
  SESSION,
  toolResult,
  toolUse,
  user,
  REVIEWER,
} from '../../test/TranscriptFixtures.ts'
import { chatStory, opensWith } from '../ChatFixtures.ts'
import { chatAgent } from '../Fixtures.ts'
import { clicks, clicksSelector } from '../StageDom.ts'
import type { StoryMaker, Witness } from '../Story.tsx'
import { SubagentsChanged } from '@crook/domain/Transcript'
import { SubagentLaunch } from '@crook/domain/TranscriptMessage'
import type { SubagentStatus } from '@crook/domain/Subagent'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'

const TOOL_HEADER = '[data-slot="tool-call-header"]'
const STOP_HOOK_ROW = 'A Stop hook blocked the stop'
const STOP_HOOK_WORDS = '[/made/up/check.sh]: Run the check before you stop.'

const RICH_MARKDOWN = [
  '## What changed',
  '',
  'The **quiet redial** keeps `canAct` false, so the composer reads as paused. [The code](https://example.com).',
  '',
  '- One list item',
  '- Another, with `code`',
  '',
  '1. First',
  '2. Second',
  '',
  '> A quoted line.',
  '',
  '| Status | canAct |',
  '| --- | --- |',
  '| Live | yes |',
  '| Dialing | no |',
  '',
  '```ts',
  'export const beginAttempt = LinkStatus.$match({',
  '  Live: (): LinkStatus => QUIET_DIALING,',
  '})',
  '```',
].join('\n')

const A_PATCH = [
  new PatchHunk({
    oldStart: 4,
    oldLines: 3,
    newStart: 4,
    newLines: 4,
    lines: [' import { Herd }', '-const herd = 1', '+const herd = 2', '+const more = 3', ' export'],
  }),
]

const toolPair = (name: string, input: Schema.Json, output: string, id = `toolu_${name}`) => [
  toolUse(0, id, name, input),
  toolResult(10, id, output),
]

const rowStory = (
  slug: string,
  title: string,
  messages: readonly TranscriptMessage[],
  shows: Witness,
  options: { readonly open?: boolean } = {},
): StoryMaker =>
  chatStory({
    slug,
    title,
    events: opensWith(messages),
    shows,
    settle: () => (options.open === true ? clicksSelector(TOOL_HEADER) : Effect.void),
  })

const toolView = (
  slug: string,
  title: string,
  name: string,
  input: Schema.Json,
  output: string,
): readonly StoryMaker[] => [
  rowStory(`tool-${slug}`, `Tool view, ${title}`, toolPair(name, input, output), {
    selector: '[data-slot="tool-call"][data-status="success"]',
  }),
  rowStory(
    `tool-${slug}-open`,
    `Tool view, ${title}, open`,
    toolPair(name, input, output),
    { selector: '[data-slot="tool-call"][data-status="success"]' },
    { open: true },
  ),
]

const runStory = (status: SubagentStatus) =>
  chatStory({
    slug: `subagent-tree-${status}`,
    title: `Subagent tree, ${status}`,
    row: chatAgent(status === 'running' ? 'working' : 'idle'),
    events: [
      opened(),
      chunk(0, 30, [
        prompt(0, 'Review the diff'),
        toolUse(10, 'toolu_review', 'Agent', {
          description: 'Review the herd diff',
          prompt: 'Read the diff and list the risks.',
          subagent_type: 'code-reviewer',
        }),
        toolResult(20, 'toolu_review', 'Async agent launched', {
          launch: new SubagentLaunch({ subagent: REVIEWER, status: 'async_launched' }),
        }),
      ]),
      caughtUp(30),
      new SubagentsChanged({
        session: SESSION,
        subagents: [subagent({ toolUseId: 'toolu_review', status })],
      }),
    ],
    shows: { selector: '[data-slot="subagent-tree"]' },
  })

export const ROW_STORIES: readonly StoryMaker[] = [
  rowStory('prompt', 'Row, your prompt', [prompt(0, 'Fix the banner')], {
    text: 'Fix the banner',
  }),
  rowStory(
    'prompt-queued',
    'Row, a prompt Claude took from its queue',
    [user(0, [new TextBlock({ text: 'Also the toast' })], { queued: true })],
    { text: 'Queued' },
  ),
  rowStory(
    'prompt-image',
    'Row, a prompt with an image',
    [
      user(0, [
        new ImageBlock({ mediaType: 'image/png', data: PIXEL_PNG }),
        new TextBlock({ text: 'This one' }),
      ]),
    ],
    { text: 'This one' },
  ),
  rowStory('text-markdown', 'Row, markdown from Claude', [answered(0, RICH_MARKDOWN)], {
    text: 'What changed',
  }),
  rowStory(
    'text-failed',
    'Row, an API error from Claude',
    [
      new AssistantMessage({
        offset: TranscriptOffset.make(0),
        uuid: Option.none(),
        timestamp: at(0),
        apiMessageId: Option.none(),
        model: Option.some('claude-opus-4-7'),
        stopReason: Option.none(),
        isApiError: true,
        blocks: [new TextBlock({ text: 'API Error: 529 overloaded_error' })],
      }),
    ],
    { text: 'API Error' },
  ),
  rowStory(
    'thinking',
    'Row, thinking between lines',
    [
      assistant(0, [new ThinkingBlock({ text: 'Reading the link state.' })]),
      said(10, 'The quiet redial is the cause.'),
    ],
    { text: 'The quiet redial' },
  ),
  rowStory(
    'tool-running',
    'Tool state, running',
    [toolUse(0, 'toolu_bash', 'Bash', { command: 'bun run lint' })],
    { selector: '[data-slot="tool-call"]' },
  ),
  rowStory(
    'tool-error',
    'Tool state, failed',
    [
      toolUse(0, 'toolu_bash', 'Bash', { command: 'bun run lint' }),
      toolResult(10, 'toolu_bash', 'Exit code 1: 3 errors', { isError: true }),
    ],
    { selector: '[data-slot="tool-call"][data-status="error"]' },
    { open: true },
  ),
  rowStory(
    'tool-stopped',
    'Tool state, stopped by an interruption',
    [toolUse(0, 'toolu_bash', 'Bash', { command: 'bun run lint' }), interrupted(10)],
    { selector: '[data-slot="tool-call"][data-status="stopped"]' },
  ),
  chatStory({
    slug: 'tool-waiting',
    title: 'Tool state, waiting for you',
    row: chatAgent('blocked'),
    events: opensWith([toolUse(0, 'toolu_bash', 'Bash', { command: 'bun run lint' })]),
    shows: { selector: '[data-slot="tool-call"][data-status="waiting"]' },
  }),
  ...toolView(
    'read',
    'Read',
    'Read',
    { file_path: `${CWD}/src/Herd.ts` },
    '     1\tconst herd = 1\n     2\texport { herd }',
  ),
  ...toolView(
    'bash',
    'Bash',
    'Bash',
    { command: 'bun run lint', description: 'Lint' },
    'Found 0 warnings and 0 errors.',
  ),
  ...toolView(
    'edit-input',
    'Edit, from its input',
    'Edit',
    { file_path: `${CWD}/src/Herd.ts`, old_string: 'const herd = 1', new_string: 'const herd = 2' },
    'The file has been updated.',
  ),
  ...toolView(
    'multi-edit',
    'MultiEdit',
    'MultiEdit',
    { file_path: `${CWD}/src/Herd.ts`, old_string: 'one', new_string: 'two' },
    'Applied 1 edit.',
  ),
  ...toolView(
    'write',
    'Write',
    'Write',
    { file_path: `${CWD}/src/New.ts`, content: 'export const brandNew = true\n' },
    'File created.',
  ),
  ...toolView('grep', 'Grep', 'Grep', { pattern: 'beginAttempt' }, 'src/rpc/HubLinkState.ts:12'),
  ...toolView('glob', 'Glob', 'Glob', { pattern: 'src/**/*.ts' }, 'src/main.ts'),
  ...toolView(
    'web-fetch',
    'WebFetch',
    'WebFetch',
    { url: 'https://effect.website', prompt: 'What is new?' },
    'A short answer.',
  ),
  ...toolView('web-search', 'WebSearch', 'WebSearch', { query: 'effect v4' }, 'Three results.'),
  ...toolView(
    'notebook',
    'NotebookEdit',
    'NotebookEdit',
    { notebook_path: `${CWD}/a.ipynb`, new_source: 'x = 1' },
    'Cell updated.',
  ),
  ...toolView('skill', 'Skill', 'Skill', { skill: 'prototype' }, 'Launching skill.'),
  ...toolView('tool-search', 'ToolSearch', 'ToolSearch', { query: 'select:Read' }, 'Matched 1.'),
  ...toolView(
    'mcp',
    'an MCP tool crook has no view for',
    'mcp__plannotator__send_message',
    { thread: 'jc-142', body: 'Done.' },
    'Sent.',
  ),
  rowStory(
    'tool-edit-patch',
    'Tool view, Edit, with the patch from its result',
    [
      toolUse(0, 'toolu_edit', 'Edit', {
        file_path: `${CWD}/src/Herd.ts`,
        old_string: 'const herd = 1',
        new_string: 'const herd = 2',
      }),
      user(10, [
        new ToolResultBlock({
          toolUseId: 'toolu_edit',
          isError: false,
          content: [new TextBlock({ text: 'The file has been updated.' })],
          patch: Option.some(A_PATCH),
          subagent: Option.none(),
          task: Option.none(),
        }),
      ]),
    ],
    { selector: '[data-slot="tool-call"][data-status="success"]' },
    { open: true },
  ),
  rowStory(
    'tool-image',
    'Tool view, a Read that returned an image',
    [
      toolUse(0, 'toolu_image', 'Read', { file_path: `${CWD}/shots/herd.png` }),
      toolResult(10, 'toolu_image', 'Read an image', { image: true }),
    ],
    { selector: '[data-slot="tool-call-footer"]' },
  ),
  chatStory({
    slug: 'image-viewer',
    title: 'Row, an image opened full screen',
    events: opensWith([
      toolUse(0, 'toolu_image', 'Read', { file_path: `${CWD}/shots/herd.png` }),
      toolResult(10, 'toolu_image', 'Read an image', { image: true }),
    ]),
    settle: () => clicks('View herd.png'),
    shows: { selector: '[role="dialog"]' },
  }),
  rowStory(
    'plan',
    'Row, a plan checklist',
    [
      toolUse(0, 'toolu_plan', 'TodoWrite', {
        todos: [
          { content: 'Read the link state', status: 'completed', activeForm: 'Reading' },
          { content: 'Find the flash', status: 'in_progress', activeForm: 'Finding' },
          { content: 'Write it down', status: 'pending', activeForm: 'Writing' },
        ],
      }),
    ],
    { selector: '[data-slot="plan"]' },
  ),
  ...Arr.map(['running', 'completed', 'failed', 'stopped'] as const, runStory),
  rowStory('note-interrupted', 'Row, Interrupted', [said(0, 'Reading.'), interrupted(10)], {
    text: 'Interrupted',
  }),
  rowStory(
    'note-notice',
    'Row, a system notice',
    [
      new SystemMessage({
        offset: TranscriptOffset.make(0),
        uuid: Option.none(),
        timestamp: at(0),
        blocks: [new NoticeBlock({ text: 'Model switched to Sonnet' })],
      }),
    ],
    { text: 'Model switched to Sonnet' },
  ),
  rowStory(
    'compacted',
    'Row, Conversation compacted',
    [compactBoundary(0), compactSummary(10, 'We were fixing the banner.')],
    { text: 'Conversation compacted' },
  ),
  rowStory(
    'stop-hook',
    'Row, a Stop hook blocked the stop, words folded away',
    [
      answered(0, 'The banner looks right.'),
      stopHookFeedback(10, STOP_HOOK_WORDS),
      said(20, 'Ran the check it asked for.'),
    ],
    { text: STOP_HOOK_ROW },
  ),
  chatStory({
    slug: 'stop-hook-open',
    title: 'Row, a Stop hook blocked the stop, words open',
    events: opensWith([
      answered(0, 'The banner looks right.'),
      stopHookFeedback(10, STOP_HOOK_WORDS),
      said(20, 'Ran the check it asked for.'),
    ]),
    settle: () => clicks(STOP_HOOK_ROW),
    shows: { text: STOP_HOOK_WORDS },
  }),
  chatStory({
    slug: 'compacted-open',
    title: 'Row, Conversation compacted, summary open',
    events: opensWith([compactBoundary(0), compactSummary(10, 'We were fixing the banner.')]),
    settle: () => clicks('Show summary'),
    shows: { text: 'We were fixing the banner.' },
  }),
  chatStory({
    slug: 'cleared',
    title: 'Row, Conversation cleared',
    events: [
      opened(),
      chunk(0, 10, [said(0, 'Before the clear.')]),
      opened(NEXT_SESSION),
      chunk(
        0,
        20,
        [
          user(0, [new LocalCommandBlock({ name: '/clear', args: '' })]),
          prompt(10, 'After the clear.'),
        ],
        NEXT_SESSION,
      ),
      caughtUp(20, NEXT_SESSION),
    ],
    shows: {
      all: [
        { text: 'Conversation cleared' },
        { text: 'After the clear.' },
        { absent: 'Before the clear.' },
      ],
    },
  }),
  rowStory(
    'unreadable',
    'Row, a line crook could not read',
    [
      assistant(0, [new UnrecognizedBlock({ kind: 'mystery' })]),
      said(10, 'And then a line it could.'),
    ],
    { text: 'And then a line it could.' },
  ),
  rowStory(
    'task-notification',
    'Row, a task notification',
    [
      toolUse(0, 'toolu_review', 'Agent', { description: 'Review the herd diff' }),
      toolResult(10, 'toolu_review', 'Async agent launched'),
      notification(20, 'toolu_review', 'completed'),
    ],
    { selector: '[data-slot="subagent-tree"]' },
  ),
  rowStory(
    'slash-local-command',
    'Slash command, a bubble and its muted output',
    [
      user(0, [new LocalCommandBlock({ name: '/rename', args: 'made up name' })]),
      user(10, [new LocalCommandOutputBlock({ text: 'Session renamed to: made up name' })]),
    ],
    { text: 'Session renamed to' },
  ),
  rowStory(
    'slash-with-args',
    'Slash command, output with inline code',
    [
      user(0, [new LocalCommandBlock({ name: '/model', args: 'opus' })]),
      user(10, [
        new LocalCommandOutputBlock({
          text: 'Set model to `Opus 5.5` and saved as your default for new sessions',
        }),
      ]),
    ],
    { selector: '[data-slot="command"] code' },
  ),
  rowStory(
    'slash-skill',
    'Slash command, a skill that starts a turn',
    [
      answered(0, 'The earlier turn ended here.'),
      user(10, [
        new LocalCommandBlock({
          name: '/handoff',
          args: 'carry on with the made up banner',
          opensTurn: true,
        }),
      ]),
      user(20, [new TextBlock({ text: 'The body of the skill, which nobody reads.' })], {
        isMeta: true,
      }),
      answered(30, 'Handed off.'),
    ],
    { text: '/handoff carry on with the made up banner' },
  ),
  rowStory(
    'slash-shell',
    'Shell line, a bubble and its output',
    [
      user(0, [new LocalCommandBlock({ name: '!', args: 'kill 1', opensTurn: true })]),
      user(10, [
        new LocalCommandOutputBlock({ text: 'kill: (1): Operation not permitted, `not code`' }),
      ]),
      answered(20, 'That one needs root.'),
    ],
    { text: '! kill 1' },
  ),
  rowStory(
    'slash-long-output',
    'Slash command, output of many lines scrolling in its own box',
    [
      user(0, [new LocalCommandBlock({ name: '/context', args: '' })]),
      user(10, [
        new LocalCommandOutputBlock({
          text: pipe(
            Arr.makeBy(40, (index) => `Made up category ${index + 1}: ${index + 1}k tokens`),
            Arr.join('\n'),
          ),
        }),
      ]),
    ],
    { text: 'Made up category 40' },
  ),
  rowStory(
    'slash-failed',
    'Slash command, a failed /compact says why and nothing else',
    [
      user(0, [new LocalCommandBlock({ name: '/compact', args: '' })]),
      user(10, [new LocalCommandOutputBlock({ text: 'Error: No messages to compact' })]),
    ],
    { text: 'Error: No messages to compact' },
  ),
  rowStory(
    'slash-unknown',
    'Slash command, one Claude does not know',
    [
      new SystemMessage({
        offset: TranscriptOffset.make(0),
        uuid: Option.none(),
        timestamp: at(0),
        blocks: [new NoticeBlock({ text: 'Unknown command: /nosuchcommand' })],
      }),
    ],
    { text: 'Unknown command' },
  ),
  rowStory(
    'slash-compact',
    'Slash command, /compact shows its divider alone',
    [
      said(0, 'The earlier conversation stays.'),
      user(10, [new TextBlock({ text: '/compact' })], { isMeta: true }),
      compactBoundary(20),
      compactSummary(30, 'We were fixing the made up banner.'),
      user(40, [new TextBlock({ text: 'caveat' })], { isMeta: true }),
      user(50, [new LocalCommandBlock({ name: '/compact', args: '' })]),
      user(60, [new LocalCommandOutputBlock({ text: 'Compacted (ctrl+o to see full summary)' })]),
    ],
    {
      all: [
        { text: 'The earlier conversation stays.' },
        { text: 'Show summary' },
        { absent: 'ctrl+o' },
      ],
    },
  ),
  rowStory(
    'tool-use-with-text',
    'Row, text and a tool in one message',
    [
      assistant(0, [
        new TextBlock({ text: 'Reading it first.' }),
        new ToolUseBlock({ id: 'toolu_read', name: 'Read', input: { file_path: 'README.md' } }),
      ]),
      toolResult(10, 'toolu_read', '1\tcrook'),
    ],
    { text: 'Reading it first.' },
  ),
]
