import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Schema from 'effect/Schema'

import { SubagentId, TranscriptOffset } from '@crook/domain/Ids'
import {
  AssistantMessage,
  type AssistantBlock,
  CompactBoundaryBlock,
  CompactTrigger,
  CompactSummaryBlock,
  ImageBlock,
  ImageMediaType,
  InterruptionBlock,
  LocalCommandBlock,
  LocalCommandOutputBlock,
  MalformedLine,
  NoticeBlock,
  PatchHunk,
  SubagentLaunch,
  SystemMessage,
  TaskNotificationBlock,
  TextBlock,
  ThinkingBlock,
  ToolReferenceBlock,
  ToolResultBlock,
  type ToolResultContent,
  type TranscriptMessage,
  ToolUseBlock,
  TurnDurationBlock,
  UnrecognizedBlock,
  UnrecognizedEntry,
  type UserBlock,
  UserMessage,
} from '@crook/domain/TranscriptMessage'

const UNKNOWN_KIND = 'unknown'
const INTERRUPTION_PREFIX = '[Request interrupted by user'
const TASK_NOTIFICATION_TAG = 'task-notification'
const TASK_ID_TAG = 'task-id'
const TASK_TOOL_USE_ID_TAG = 'tool-use-id'
const TASK_STATUS_TAG = 'status'
const TASK_SUMMARY_TAG = 'summary'
const TASK_RESULT_TAG = 'result'
const TOOL_RESULT_KIND = 'tool_result'
const COMMAND_NAME_TAG = 'command-name'
const COMMAND_ARGS_TAG = 'command-args'
const COMMAND_STDOUT_TAG = 'local-command-stdout'
const HUMAN_ORIGIN = 'human'
const QUEUED_PROMPT_MODE = 'prompt'
const ANSI_ESCAPE = String.fromCodePoint(0x1b)
const ANSI_SEQUENCE = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*[A-Za-z]`, 'gu')
const RECORD_OPENER = '{'.charCodeAt(0)
const RECORD_STARTS = ['{"parentUuid"', '{"type"']

const METADATA_ENTRY_TYPES = HashSet.make(
  'last-prompt',
  'atis-latch',
  'mode',
  'permission-mode',
  'queue-operation',
  'ai-title',
  'custom-title',
  'agent-name',
  'api-request-blob',
  'api-request',
  'file-history-snapshot',
  'file-history-delta',
  'started',
  'result',
  'launched',
  'pr-link',
  'bridge-session',
  'cost-state',
  'relocated',
  'agent-setting',
  'api-request-shape',
  'dev-mods',
  'worktree-state',
  'fork-context-ref',
)

const METADATA_SYSTEM_SUBTYPES = HashSet.make('stop_hook_summary', 'agents_killed')
const NOTICE_SYSTEM_SUBTYPES = HashSet.make('informational', 'scheduled_task_fire')

const KNOWN_ATTACHMENT_TYPES = HashSet.make(
  'total_tokens_reminder',
  'deferred_tools_record',
  'prompt_snapshot',
  'environment',
  'deferred_tools_delta',
  'skill_listing',
  'mcp_instructions_delta',
  'date',
  'model',
  'session_context',
  'auto_mode',
  'instructions',
  'silent_turn_reminder',
  'structured_output',
  'credential_org',
  'nested_memory',
  'command_permissions',
  'agent_listing_delta',
  'queued_command',
  'file',
  'batching_reminder_sent',
  'edited_text_file',
  'bash_output_audience_note',
  'invoked_skills',
  'compact_file_reference',
  'hook_non_blocking_error',
  'thinking_drop',
  'remote_session_change',
  'hook_blocking_error',
  'task_status',
  'directory',
  'plan_mode_exit',
  'read_truncation_notice',
  'auto_mode_exit',
  'hook_success',
  'date_change',
  'dynamic_skill',
  'output_style',
  'hook_additional_context',
  'peer_mention',
  'plan_mode',
  'task_reminder',
  'hook_cancelled',
  'session_cron_carry',
  'max_turns_reached',
)

const Line = Schema.fromJsonString(Schema.Json)

const Content = Schema.Union([Schema.String, Schema.Array(Schema.Json)])

const Kind = Schema.Struct({ type: Schema.String })

const Envelope = Schema.Struct({
  uuid: Schema.optionalKey(Schema.String),
  timestamp: Schema.optionalKey(Schema.String),
})

const RawUser = Schema.Struct({
  message: Schema.Struct({ content: Content }),
  isMeta: Schema.optionalKey(Schema.Boolean),
  isCompactSummary: Schema.optionalKey(Schema.Boolean),
  origin: Schema.optionalKey(Schema.Struct({ kind: Schema.String })),
  toolUseResult: Schema.optionalKey(Schema.Json),
})

const RawAssistant = Schema.Struct({
  message: Schema.Struct({
    id: Schema.optionalKey(Schema.String),
    model: Schema.optionalKey(Schema.String),
    stop_reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
    content: Schema.Array(Schema.Json),
  }),
  isApiErrorMessage: Schema.optionalKey(Schema.Boolean),
})

const RawSystem = Schema.Struct({
  subtype: Schema.String,
  content: Schema.optionalKey(Schema.String),
  durationMs: Schema.optionalKey(Schema.Finite),
  compactMetadata: Schema.optionalKey(
    Schema.Struct({
      trigger: Schema.optionalKey(Schema.String),
      preTokens: Schema.optionalKey(Schema.Finite),
      postTokens: Schema.optionalKey(Schema.Finite),
    }),
  ),
})

const RawAttachment = Schema.Struct({
  attachment: Schema.Struct({
    type: Schema.String,
    commandMode: Schema.optionalKey(Schema.String),
    prompt: Schema.optionalKey(Content),
    origin: Schema.optionalKey(Schema.Struct({ kind: Schema.String })),
  }),
})

const RawText = Schema.Struct({ type: Schema.Literal('text'), text: Schema.String })

const RawThinking = Schema.Struct({ type: Schema.Literal('thinking'), thinking: Schema.String })

const RawToolUse = Schema.Struct({
  type: Schema.Literal('tool_use'),
  id: Schema.String,
  name: Schema.String,
  input: Schema.Json,
})

const RawSourcedImage = Schema.Struct({
  type: Schema.Literal('image'),
  source: Schema.Struct({
    type: Schema.Literal('base64'),
    media_type: ImageMediaType,
    data: Schema.String,
  }),
})

const RawInlineImage = Schema.Struct({
  type: Schema.Literal('image'),
  data: Schema.String,
  mimeType: ImageMediaType,
})

const RawToolReference = Schema.Struct({
  type: Schema.Literal('tool_reference'),
  tool_name: Schema.String,
})

const RawToolResult = Schema.Struct({
  type: Schema.Literal(TOOL_RESULT_KIND),
  tool_use_id: Schema.String,
  is_error: Schema.optionalKey(Schema.Boolean),
  content: Schema.optionalKey(Content),
})

const RawPatch = Schema.Struct({
  structuredPatch: Schema.Array(
    Schema.Struct({
      oldStart: Schema.Int,
      oldLines: Schema.Int,
      newStart: Schema.Int,
      newLines: Schema.Int,
      lines: Schema.Array(Schema.String),
    }),
  ),
})

const RawLaunch = Schema.Struct({ agentId: SubagentId, status: Schema.String })

type RawUser = typeof RawUser.Type

const decodeKind = Schema.decodeUnknownOption(Kind)
const decodeText = Schema.decodeUnknownOption(RawText)
const decodeThinking = Schema.decodeUnknownOption(RawThinking)
const decodeToolUse = Schema.decodeUnknownOption(RawToolUse)
const decodeSourcedImage = Schema.decodeUnknownOption(RawSourcedImage)
const decodeInlineImage = Schema.decodeUnknownOption(RawInlineImage)
const decodeToolReference = Schema.decodeUnknownOption(RawToolReference)
const decodeToolResult = Schema.decodeUnknownOption(RawToolResult)
const decodePatch = Schema.decodeUnknownOption(RawPatch)
const decodeLaunch = Schema.decodeUnknownOption(RawLaunch)
const decodeCompactTrigger = Schema.decodeUnknownOption(CompactTrigger)
const decodeEnvelope = Schema.decodeUnknownOption(Envelope)
const decodeUser = Schema.decodeUnknownOption(RawUser)
const decodeAssistant = Schema.decodeUnknownOption(RawAssistant)
const decodeSystem = Schema.decodeUnknownOption(RawSystem)
const decodeAttachment = Schema.decodeUnknownOption(RawAttachment)

const kindOf = (value: Schema.Json) =>
  decodeKind(value).pipe(
    Option.map((found) => found.type),
    Option.getOrElse(() => UNKNOWN_KIND),
  )

const taggedText = (text: string, tag: string) =>
  Option.fromNullishOr(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'u').exec(text)?.[1])

const withoutAnsi = (text: string) => text.replaceAll(ANSI_SEQUENCE, '')

const textBlock = (text: string) => new TextBlock({ text })

const imageOf = (value: Schema.Json) =>
  pipe(
    decodeSourcedImage(value),
    Option.map(
      (raw) => new ImageBlock({ mediaType: raw.source.media_type, data: raw.source.data }),
    ),
    Option.orElse(() =>
      Option.map(
        decodeInlineImage(value),
        (raw) => new ImageBlock({ mediaType: raw.mimeType, data: raw.data }),
      ),
    ),
  )

const contentBlock = (value: Schema.Json): ToolResultContent =>
  pipe(
    decodeText(value),
    Option.map((raw): ToolResultContent => textBlock(raw.text)),
    Option.orElse((): Option.Option<ToolResultContent> => imageOf(value)),
    Option.orElse(() =>
      Option.map(
        decodeToolReference(value),
        (raw) => new ToolReferenceBlock({ toolName: raw.tool_name }),
      ),
    ),
    Option.getOrElse(() => new UnrecognizedBlock({ kind: kindOf(value) })),
  )

const toolResultContent = (content: Option.Option<typeof Content.Type>) =>
  Option.match(content, {
    onNone: () => Arr.empty<ToolResultContent>(),
    onSome: (found) =>
      Predicate.isString(found) ? [textBlock(found)] : Arr.map(found, contentBlock),
  })

const patchOf = (result: Option.Option<Schema.Json>) =>
  pipe(
    result,
    Option.flatMap(decodePatch),
    Option.map((raw) => Arr.map(raw.structuredPatch, (hunk) => new PatchHunk(hunk))),
    Option.filter((hunks) => Arr.isReadonlyArrayNonEmpty(hunks)),
  )

const launchOf = (result: Option.Option<Schema.Json>) =>
  pipe(
    result,
    Option.flatMap(decodeLaunch),
    Option.map((raw) => new SubagentLaunch({ subagent: raw.agentId, status: raw.status })),
  )

const toolResultBlock =
  (details: Option.Option<Schema.Json>) =>
  (raw: typeof RawToolResult.Type): UserBlock =>
    new ToolResultBlock({
      toolUseId: raw.tool_use_id,
      isError: raw.is_error ?? false,
      content: toolResultContent(Option.fromUndefinedOr(raw.content)),
      patch: patchOf(details),
      subagent: launchOf(details),
    })

const userTextBlock = (text: string): UserBlock =>
  text.startsWith(INTERRUPTION_PREFIX) ? new InterruptionBlock({ text }) : textBlock(text)

const userBlock =
  (details: Option.Option<Schema.Json>) =>
  (value: Schema.Json): UserBlock =>
    pipe(
      decodeToolResult(value),
      Option.map(toolResultBlock(details)),
      Option.orElse(() => Option.map(decodeText(value), (raw) => userTextBlock(raw.text))),
      Option.orElse((): Option.Option<UserBlock> => imageOf(value)),
      Option.getOrElse((): UserBlock => new UnrecognizedBlock({ kind: kindOf(value) })),
    )

const taskNotificationBlock = (text: string) =>
  Option.map(
    taggedText(text, TASK_ID_TAG),
    (taskId) =>
      new TaskNotificationBlock({
        taskId,
        toolUseId: taggedText(text, TASK_TOOL_USE_ID_TAG),
        status: taggedText(text, TASK_STATUS_TAG),
        summary: taggedText(text, TASK_SUMMARY_TAG),
        result: taggedText(text, TASK_RESULT_TAG),
      }),
  )

const localCommandBlock = (text: string) =>
  Option.map(
    taggedText(text, COMMAND_NAME_TAG),
    (name) =>
      new LocalCommandBlock({
        name,
        args: Option.getOrElse(taggedText(text, COMMAND_ARGS_TAG), () => ''),
      }),
  )

const commandOutputOf = (text: string) =>
  Option.map(
    taggedText(text, COMMAND_STDOUT_TAG),
    (output) => new LocalCommandOutputBlock({ text: withoutAnsi(output) }),
  )

const isTaskNotification = (raw: RawUser) => (text: string) =>
  raw.origin?.kind === TASK_NOTIFICATION_TAG ||
  text.trimStart().startsWith(`<${TASK_NOTIFICATION_TAG}>`)

const stringContentBlock = (raw: RawUser, text: string): UserBlock =>
  pipe(
    Option.liftPredicate(raw, (entry) => entry.isCompactSummary === true),
    Option.map((): UserBlock => new CompactSummaryBlock({ text })),
    Option.orElse((): Option.Option<UserBlock> =>
      pipe(
        Option.liftPredicate(text, isTaskNotification(raw)),
        Option.flatMap(taskNotificationBlock),
      ),
    ),
    Option.orElse((): Option.Option<UserBlock> => localCommandBlock(text)),
    Option.orElse((): Option.Option<UserBlock> => commandOutputOf(text)),
    Option.getOrElse(() => userTextBlock(text)),
  )

const singleToolResultDetails = (raw: RawUser) =>
  Predicate.isString(raw.message.content) ||
  Arr.filter(raw.message.content, (value) => kindOf(value) === TOOL_RESULT_KIND).length !== 1
    ? Option.none<Schema.Json>()
    : Option.fromUndefinedOr(raw.toolUseResult)

const userBlocks = (raw: RawUser): readonly UserBlock[] => {
  const content = raw.message.content

  return Predicate.isString(content)
    ? [stringContentBlock(raw, content)]
    : Arr.map(content, userBlock(singleToolResultDetails(raw)))
}

const envelopeOf = (json: Schema.Json, offset: TranscriptOffset) => {
  const envelope = decodeEnvelope(json)

  return {
    offset,
    uuid: Option.flatMap(envelope, (found) => Option.fromUndefinedOr(found.uuid)),
    timestamp: pipe(
      envelope,
      Option.flatMap((found) => Option.fromUndefinedOr(found.timestamp)),
      Option.flatMap((timestamp) => DateTime.make(timestamp)),
      Option.map(DateTime.toUtc),
    ),
  }
}

const unrecognizedEntry = (offset: TranscriptOffset, entryType: string) => [
  new UnrecognizedEntry({ offset, entryType }),
]

const userEntry = (json: Schema.Json, offset: TranscriptOffset): readonly TranscriptMessage[] =>
  Option.match(decodeUser(json), {
    onNone: () => unrecognizedEntry(offset, 'user'),
    onSome: (raw) => [
      new UserMessage({
        ...envelopeOf(json, offset),
        isMeta: raw.isMeta ?? false,
        origin: Option.fromUndefinedOr(raw.origin?.kind),
        queued: false,
        blocks: userBlocks(raw),
      }),
    ],
  })

const assistantBlock = (value: Schema.Json): AssistantBlock =>
  pipe(
    decodeText(value),
    Option.map((raw): AssistantBlock => textBlock(raw.text)),
    Option.orElse(() =>
      Option.map(decodeThinking(value), (raw) => new ThinkingBlock({ text: raw.thinking })),
    ),
    Option.orElse(() =>
      Option.map(
        decodeToolUse(value),
        (raw) => new ToolUseBlock({ id: raw.id, name: raw.name, input: raw.input }),
      ),
    ),
    Option.getOrElse(() => new UnrecognizedBlock({ kind: kindOf(value) })),
  )

const assistantEntry = (
  json: Schema.Json,
  offset: TranscriptOffset,
): readonly TranscriptMessage[] =>
  Option.match(decodeAssistant(json), {
    onNone: () => unrecognizedEntry(offset, 'assistant'),
    onSome: (raw) => [
      new AssistantMessage({
        ...envelopeOf(json, offset),
        apiMessageId: Option.fromUndefinedOr(raw.message.id),
        model: Option.fromUndefinedOr(raw.message.model),
        stopReason: Option.fromNullishOr(raw.message.stop_reason),
        isApiError: raw.isApiErrorMessage ?? false,
        blocks: Arr.map(raw.message.content, assistantBlock),
      }),
    ],
  })

const wholeNumber = (value: number | undefined) =>
  Option.filter(Option.fromUndefinedOr(value), Number.isInteger)

const systemMessage =
  (json: Schema.Json, offset: TranscriptOffset) =>
  (block: CompactBoundaryBlock | TurnDurationBlock | LocalCommandOutputBlock | NoticeBlock) => [
    new SystemMessage({ ...envelopeOf(json, offset), blocks: [block] }),
  ]

const systemEntryOf = (
  raw: typeof RawSystem.Type,
  json: Schema.Json,
  offset: TranscriptOffset,
): readonly TranscriptMessage[] =>
  Match.value(raw.subtype).pipe(
    Match.when('compact_boundary', () =>
      systemMessage(
        json,
        offset,
      )(
        new CompactBoundaryBlock({
          trigger: Option.flatMap(
            Option.fromUndefinedOr(raw.compactMetadata?.trigger),
            decodeCompactTrigger,
          ),
          tokensBefore: wholeNumber(raw.compactMetadata?.preTokens),
          tokensAfter: wholeNumber(raw.compactMetadata?.postTokens),
        }),
      ),
    ),
    Match.when('turn_duration', () =>
      Option.match(wholeNumber(raw.durationMs), {
        onNone: () => unrecognizedEntry(offset, 'system/turn_duration'),
        onSome: (durationMs) => systemMessage(json, offset)(new TurnDurationBlock({ durationMs })),
      }),
    ),
    Match.when('local_command', () =>
      pipe(
        Option.fromUndefinedOr(raw.content),
        Option.flatMap(commandOutputOf),
        Option.filter((output) => output.text.trim().length > 0),
        Option.match({ onNone: () => [], onSome: systemMessage(json, offset) }),
      ),
    ),
    Match.when(
      (subtype) => HashSet.has(NOTICE_SYSTEM_SUBTYPES, subtype),
      () =>
        Option.match(Option.fromUndefinedOr(raw.content), {
          onNone: () => [],
          onSome: (text) => systemMessage(json, offset)(new NoticeBlock({ text })),
        }),
    ),
    Match.when(
      (subtype) => HashSet.has(METADATA_SYSTEM_SUBTYPES, subtype),
      () => [],
    ),
    Match.orElse((subtype) => unrecognizedEntry(offset, `system/${subtype}`)),
  )

const systemEntry = (json: Schema.Json, offset: TranscriptOffset): readonly TranscriptMessage[] =>
  Option.match(decodeSystem(json), {
    onNone: () => unrecognizedEntry(offset, 'system'),
    onSome: (raw) => systemEntryOf(raw, json, offset),
  })

const isQueuedHumanPrompt = (attachment: typeof RawAttachment.Type.attachment) =>
  attachment.commandMode === QUEUED_PROMPT_MODE && attachment.origin?.kind === HUMAN_ORIGIN

const queuedPrompt = (
  attachment: typeof RawAttachment.Type.attachment,
  json: Schema.Json,
  offset: TranscriptOffset,
): readonly TranscriptMessage[] =>
  pipe(
    Option.liftPredicate(attachment, isQueuedHumanPrompt),
    Option.flatMap((queued) => Option.fromUndefinedOr(queued.prompt)),
    Option.map((prompt) =>
      Predicate.isString(prompt)
        ? [userTextBlock(prompt)]
        : Arr.map(prompt, userBlock(Option.none())),
    ),
    Option.match({
      onNone: () => [],
      onSome: (blocks) => [
        new UserMessage({
          ...envelopeOf(json, offset),
          isMeta: false,
          origin: Option.some(HUMAN_ORIGIN),
          queued: true,
          blocks,
        }),
      ],
    }),
  )

const attachmentEntry = (
  json: Schema.Json,
  offset: TranscriptOffset,
): readonly TranscriptMessage[] =>
  Option.match(decodeAttachment(json), {
    onNone: () => unrecognizedEntry(offset, 'attachment'),
    onSome: ({ attachment }) =>
      HashSet.has(KNOWN_ATTACHMENT_TYPES, attachment.type)
        ? queuedPrompt(attachment, json, offset)
        : unrecognizedEntry(offset, `attachment/${attachment.type}`),
  })

const entry = (json: Schema.Json, offset: TranscriptOffset): readonly TranscriptMessage[] =>
  Match.value(kindOf(json)).pipe(
    Match.when('user', () => userEntry(json, offset)),
    Match.when('assistant', () => assistantEntry(json, offset)),
    Match.when('system', () => systemEntry(json, offset)),
    Match.when('attachment', () => attachmentEntry(json, offset)),
    Match.when(
      (type) => HashSet.has(METADATA_ENTRY_TYPES, type),
      () => [],
    ),
    Match.orElse((type) => unrecognizedEntry(offset, type)),
  )

const decodeLine = Schema.decodeUnknownOption(Line)

const decoder = new TextDecoder()

const encoder = new TextEncoder()

const recordStartBytes = Arr.map(RECORD_STARTS, (start) => encoder.encode(start))

const opensRecordAt = (bytes: Uint8Array) => (at: number) =>
  Arr.some(recordStartBytes, (start) => start.every((byte, index) => bytes[at + index] === byte))

const recordStarts = (bytes: Uint8Array) =>
  pipe(
    Arr.unfold(1, (from) =>
      Option.map(
        Option.liftPredicate(bytes.indexOf(RECORD_OPENER, from), (found) => found >= 0),
        (found) => [found, found + 1] as const,
      ),
    ),
    Arr.filter(opensRecordAt(bytes)),
  )

const salvaged = (bytes: Uint8Array, offset: TranscriptOffset): readonly TranscriptMessage[] =>
  pipe(
    recordStarts(bytes),
    Arr.findFirst((start) =>
      Option.map(decodeLine(decoder.decode(bytes.subarray(start))), (json) => ({ start, json })),
    ),
    Option.match({
      onNone: () => [new MalformedLine({ offset, byteLength: bytes.length })],
      onSome: ({ start, json }) => [
        new MalformedLine({ offset, byteLength: start }),
        ...entry(json, TranscriptOffset.make(offset + start)),
      ],
    }),
  )

export const parseLine = (
  bytes: Uint8Array,
  offset: TranscriptOffset,
): readonly TranscriptMessage[] => {
  const text = decoder.decode(bytes)

  return text.trim().length === 0
    ? []
    : Option.match(decodeLine(text), {
        onNone: () => salvaged(bytes, offset),
        onSome: (json) => entry(json, offset),
      })
}
