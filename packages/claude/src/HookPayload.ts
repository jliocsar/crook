import * as Schema from 'effect/Schema'

import { ClaudeSessionId } from '@crook/domain/Ids'

export const CLAUDE_HOOK_EVENTS = [
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
] as const

export const toolCallFields = {
  tool_name: Schema.String,
  tool_input: Schema.Json,
  tool_use_id: Schema.String,
}

export class PreToolUsePayload extends Schema.Class<PreToolUsePayload>('PreToolUsePayload')({
  hook_event_name: Schema.Literal('PreToolUse'),
  session_id: ClaudeSessionId,
  ...toolCallFields,
}) {}

export class PermissionRequestPayload extends Schema.Class<PermissionRequestPayload>(
  'PermissionRequestPayload',
)({
  hook_event_name: Schema.Literal('PermissionRequest'),
  session_id: ClaudeSessionId,
  tool_name: Schema.String,
  tool_input: Schema.Json,
}) {}

export class PostToolUsePayload extends Schema.Class<PostToolUsePayload>('PostToolUsePayload')({
  hook_event_name: Schema.Literal('PostToolUse'),
  session_id: ClaudeSessionId,
  ...toolCallFields,
}) {}

export class PostToolUseFailurePayload extends Schema.Class<PostToolUseFailurePayload>(
  'PostToolUseFailurePayload',
)({
  hook_event_name: Schema.Literal('PostToolUseFailure'),
  session_id: ClaudeSessionId,
  ...toolCallFields,
}) {}

export class FinishedToolCall extends Schema.Class<FinishedToolCall>('FinishedToolCall')(
  toolCallFields,
) {}

export class PostToolBatchPayload extends Schema.Class<PostToolBatchPayload>(
  'PostToolBatchPayload',
)({
  hook_event_name: Schema.Literal('PostToolBatch'),
  session_id: ClaudeSessionId,
  tool_calls: Schema.Array(FinishedToolCall),
}) {}

export const HookPayload = Schema.Union([
  PreToolUsePayload,
  PermissionRequestPayload,
  PostToolUsePayload,
  PostToolUseFailurePayload,
  PostToolBatchPayload,
])
export type HookPayload = typeof HookPayload.Type

export const HookPayloadFromJson = Schema.fromJsonString(HookPayload)
