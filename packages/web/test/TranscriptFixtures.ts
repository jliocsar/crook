import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import type * as Schema from 'effect/Schema'

import { ClaudeSessionId, SubagentId, TranscriptOffset } from '@crook/domain/Ids'
import { Subagent } from '@crook/domain/Subagent'
import { TranscriptCaughtUp, TranscriptChunk, TranscriptOpened } from '@crook/domain/Transcript'
import {
  AssistantMessage,
  CompactBoundaryBlock,
  CompactSummaryBlock,
  ImageBlock,
  InterruptionBlock,
  SystemMessage,
  TaskNotificationBlock,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
  UserMessage,
} from '@crook/domain/TranscriptMessage'
import type {
  AssistantBlock,
  SubagentLaunch,
  TranscriptMessage,
  UserBlock,
} from '@crook/domain/TranscriptMessage'

export const SESSION = ClaudeSessionId.make('5b1f3c0e-4f7e-4a59-9d1c-2f7d9e0c6a11')
export const NEXT_SESSION = ClaudeSessionId.make('9a7c2d4b-1e3f-4b6a-8c5d-0e2f4a6b8c1d')
export const REVIEWER = SubagentId.make('a1b2c3d4')
export const CWD = '/home/jliocsar/Projects/crook'

export const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export const at = (seconds: number) =>
  Option.some(DateTime.makeUnsafe(`2026-10-20T12:00:${String(seconds).padStart(2, '0')}Z`))

export const user = (
  offset: number,
  blocks: readonly UserBlock[],
  options: { readonly isMeta?: boolean; readonly queued?: boolean; readonly seconds?: number } = {},
) =>
  new UserMessage({
    offset: TranscriptOffset.make(offset),
    uuid: Option.none(),
    timestamp: at(options.seconds ?? 0),
    isMeta: options.isMeta ?? false,
    origin: Option.none(),
    queued: options.queued ?? false,
    blocks,
  })

export const assistant = (offset: number, blocks: readonly AssistantBlock[], seconds = 0) =>
  new AssistantMessage({
    offset: TranscriptOffset.make(offset),
    uuid: Option.none(),
    timestamp: at(seconds),
    apiMessageId: Option.none(),
    model: Option.some('claude-opus-4-7'),
    stopReason: Option.none(),
    isApiError: false,
    blocks,
  })

export const prompt = (offset: number, text: string) => user(offset, [new TextBlock({ text })])

export const said = (offset: number, text: string) => assistant(offset, [new TextBlock({ text })])

export const toolUse = (
  offset: number,
  id: string,
  name: string,
  input: Schema.Json,
  seconds = 0,
) => assistant(offset, [new ToolUseBlock({ id, name, input })], seconds)

export const toolResult = (
  offset: number,
  id: string,
  text: string,
  options: {
    readonly isError?: boolean
    readonly image?: boolean
    readonly launch?: SubagentLaunch
    readonly seconds?: number
  } = {},
) =>
  user(
    offset,
    [
      new ToolResultBlock({
        toolUseId: id,
        isError: options.isError ?? false,
        content: [
          new TextBlock({ text }),
          ...(options.image === true
            ? [new ImageBlock({ mediaType: 'image/png', data: PIXEL_PNG })]
            : []),
        ],
        patch: Option.none(),
        subagent: Option.fromUndefinedOr(options.launch),
      }),
    ],
    { seconds: options.seconds ?? 0 },
  )

export const notification = (offset: number, toolUseId: string, status: string) =>
  user(offset, [
    new TaskNotificationBlock({
      taskId: 'task-1',
      toolUseId: Option.some(toolUseId),
      status: Option.some(status),
      summary: Option.some('Reviewer finished'),
      result: Option.none(),
    }),
  ])

export const compactBoundary = (offset: number) =>
  new SystemMessage({
    offset: TranscriptOffset.make(offset),
    uuid: Option.none(),
    timestamp: at(0),
    blocks: [
      new CompactBoundaryBlock({
        trigger: Option.some('manual'),
        tokensBefore: Option.none(),
        tokensAfter: Option.none(),
      }),
    ],
  })

export const compactSummary = (offset: number, text: string) =>
  user(offset, [new CompactSummaryBlock({ text })])

export const interrupted = (offset: number) =>
  user(offset, [new InterruptionBlock({ text: '[Request interrupted by user]' })])

export const subagent = (options: {
  readonly toolUseId: string
  readonly finished?: boolean
  readonly id?: SubagentId
}) =>
  new Subagent({
    id: options.id ?? REVIEWER,
    agentType: 'code-reviewer',
    description: 'Review the herd diff',
    model: Option.some('claude-sonnet-4-6'),
    toolUseId: Option.some(options.toolUseId),
    parent: Option.none(),
    spawnDepth: 1,
    background: true,
    finished: options.finished ?? false,
    stoppedByUser: false,
  })

export const opened = (session = SESSION) => new TranscriptOpened({ session })

export const caughtUp = (offset: number, session = SESSION) =>
  new TranscriptCaughtUp({ session, offset: TranscriptOffset.make(offset) })

export const chunk = (
  offset: number,
  nextOffset: number,
  messages: readonly TranscriptMessage[],
  session = SESSION,
) =>
  new TranscriptChunk({
    session,
    offset: TranscriptOffset.make(offset),
    nextOffset: TranscriptOffset.make(nextOffset),
    messages,
  })
