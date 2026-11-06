import * as Match from 'effect/Match'
import * as Schema from 'effect/Schema'

import { SubagentId, TranscriptOffset } from '@crook/domain/Ids'

export class TextBlock extends Schema.TaggedClass<TextBlock>()('Text', {
  text: Schema.String,
}) {}

export class ThinkingBlock extends Schema.TaggedClass<ThinkingBlock>()('Thinking', {
  text: Schema.String,
}) {}

export class ToolUseBlock extends Schema.TaggedClass<ToolUseBlock>()('ToolUse', {
  id: Schema.String,
  name: Schema.String,
  input: Schema.Json,
}) {}

export const ImageMediaType = Schema.Literals(['image/png', 'image/jpeg'])
export type ImageMediaType = typeof ImageMediaType.Type

export const CompactTrigger = Schema.Literals(['manual', 'auto'])
export type CompactTrigger = typeof CompactTrigger.Type

export class ImageBlock extends Schema.TaggedClass<ImageBlock>()('Image', {
  mediaType: ImageMediaType,
  data: Schema.String,
}) {}

export class ToolReferenceBlock extends Schema.TaggedClass<ToolReferenceBlock>()('ToolReference', {
  toolName: Schema.String,
}) {}

export class UnrecognizedBlock extends Schema.TaggedClass<UnrecognizedBlock>()('Unrecognized', {
  kind: Schema.String,
}) {}

export class PatchHunk extends Schema.Class<PatchHunk>('PatchHunk')({
  oldStart: Schema.Int,
  oldLines: Schema.Int,
  newStart: Schema.Int,
  newLines: Schema.Int,
  lines: Schema.Array(Schema.String),
}) {}

export class SubagentLaunch extends Schema.Class<SubagentLaunch>('SubagentLaunch')({
  subagent: SubagentId,
  status: Schema.String,
}) {}

export class TaskLaunch extends Schema.Class<TaskLaunch>('TaskLaunch')({
  taskId: Schema.String,
  timeoutMs: Schema.OptionFromNullOr(Schema.Int),
}) {}

export const ToolResultContent = Schema.Union([
  TextBlock,
  ImageBlock,
  ToolReferenceBlock,
  UnrecognizedBlock,
])
export type ToolResultContent = typeof ToolResultContent.Type

export class ToolResultBlock extends Schema.TaggedClass<ToolResultBlock>()('ToolResult', {
  toolUseId: Schema.String,
  isError: Schema.Boolean,
  content: Schema.Array(ToolResultContent),
  patch: Schema.OptionFromNullOr(Schema.Array(PatchHunk)),
  subagent: Schema.OptionFromNullOr(SubagentLaunch),
  task: Schema.OptionFromOptionalKey(TaskLaunch),
}) {}

export class CompactSummaryBlock extends Schema.TaggedClass<CompactSummaryBlock>()(
  'CompactSummary',
  { text: Schema.String },
) {}

export class TaskNotificationBlock extends Schema.TaggedClass<TaskNotificationBlock>()(
  'TaskNotification',
  {
    taskId: Schema.String,
    toolUseId: Schema.OptionFromNullOr(Schema.String),
    status: Schema.OptionFromNullOr(Schema.String),
    summary: Schema.OptionFromNullOr(Schema.String),
    result: Schema.OptionFromNullOr(Schema.String),
    event: Schema.OptionFromOptionalKey(Schema.String),
    outputFile: Schema.OptionFromOptionalKey(Schema.String),
  },
) {}

export const SHELL_COMMAND_NAME = '!'

export class LocalCommandBlock extends Schema.TaggedClass<LocalCommandBlock>()('LocalCommand', {
  name: Schema.String,
  args: Schema.String,
  opensTurn: Schema.optionalKey(Schema.Boolean),
}) {}

export class LocalCommandOutputBlock extends Schema.TaggedClass<LocalCommandOutputBlock>()(
  'LocalCommandOutput',
  { text: Schema.String },
) {}

export class InterruptionBlock extends Schema.TaggedClass<InterruptionBlock>()('Interruption', {
  text: Schema.String,
}) {}

export class CompactBoundaryBlock extends Schema.TaggedClass<CompactBoundaryBlock>()(
  'CompactBoundary',
  {
    trigger: Schema.OptionFromNullOr(CompactTrigger),
    tokensBefore: Schema.OptionFromNullOr(Schema.Int),
    tokensAfter: Schema.OptionFromNullOr(Schema.Int),
  },
) {}

export class TurnDurationBlock extends Schema.TaggedClass<TurnDurationBlock>()('TurnDuration', {
  durationMs: Schema.Int,
}) {}

export class NoticeBlock extends Schema.TaggedClass<NoticeBlock>()('Notice', {
  text: Schema.String,
}) {}

export const UserBlock = Schema.Union([
  TextBlock,
  ImageBlock,
  ToolResultBlock,
  CompactSummaryBlock,
  TaskNotificationBlock,
  LocalCommandBlock,
  LocalCommandOutputBlock,
  InterruptionBlock,
  UnrecognizedBlock,
])
export type UserBlock = typeof UserBlock.Type

export const isTypedBlock = (block: UserBlock): boolean =>
  Match.value(block).pipe(
    Match.tagsExhaustive({
      Text: () => true,
      Image: () => true,
      LocalCommand: () => true,
      ToolResult: () => false,
      CompactSummary: () => false,
      TaskNotification: () => false,
      LocalCommandOutput: () => false,
      Interruption: () => false,
      Unrecognized: () => false,
    }),
  )

export const AssistantBlock = Schema.Union([
  TextBlock,
  ThinkingBlock,
  ToolUseBlock,
  UnrecognizedBlock,
])
export type AssistantBlock = typeof AssistantBlock.Type

const SystemBlock = Schema.Union([
  CompactBoundaryBlock,
  TurnDurationBlock,
  LocalCommandOutputBlock,
  NoticeBlock,
  UnrecognizedBlock,
])
type SystemBlock = typeof SystemBlock.Type

const entryFields = {
  offset: TranscriptOffset,
  uuid: Schema.OptionFromNullOr(Schema.String),
  timestamp: Schema.OptionFromNullOr(Schema.DateTimeUtcFromString),
}

export class UserMessage extends Schema.TaggedClass<UserMessage>()('User', {
  ...entryFields,
  isMeta: Schema.Boolean,
  origin: Schema.OptionFromNullOr(Schema.String),
  queued: Schema.Boolean,
  blocks: Schema.Array(UserBlock),
  stopHookFeedback: Schema.optionalKey(Schema.Boolean),
}) {}

export class AssistantMessage extends Schema.TaggedClass<AssistantMessage>()('Assistant', {
  ...entryFields,
  apiMessageId: Schema.OptionFromNullOr(Schema.String),
  model: Schema.OptionFromNullOr(Schema.String),
  stopReason: Schema.OptionFromNullOr(Schema.String),
  isApiError: Schema.Boolean,
  blocks: Schema.Array(AssistantBlock),
}) {}

export class SystemMessage extends Schema.TaggedClass<SystemMessage>()('System', {
  ...entryFields,
  blocks: Schema.Array(SystemBlock),
}) {}

export class UnrecognizedEntry extends Schema.TaggedClass<UnrecognizedEntry>()(
  'UnrecognizedEntry',
  { offset: TranscriptOffset, entryType: Schema.String },
) {}

export class MalformedLine extends Schema.TaggedClass<MalformedLine>()('Malformed', {
  offset: TranscriptOffset,
  byteLength: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

export class OmittedLines extends Schema.TaggedClass<OmittedLines>()('Omitted', {
  offset: TranscriptOffset,
  byteLength: Schema.Int.check(Schema.isGreaterThan(0)),
}) {}

export const TranscriptMessage = Schema.Union([
  UserMessage,
  AssistantMessage,
  SystemMessage,
  UnrecognizedEntry,
  MalformedLine,
  OmittedLines,
])
export type TranscriptMessage = typeof TranscriptMessage.Type
