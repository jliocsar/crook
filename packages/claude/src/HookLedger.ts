import * as Arr from 'effect/Array'
import * as Equal from 'effect/Equal'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import type * as Schema from 'effect/Schema'

import type {
  HookPayload,
  PermissionRequestPayload,
  PreToolUsePayload,
} from '@crook/claude/HookPayload'
import type { ClaudeSessionId } from '@crook/domain/Ids'

export interface StartedToolCall {
  readonly sequence: number
  readonly toolName: string
  readonly toolInput: Schema.Json
  readonly toolUseId: string
}

export interface PendingPermission {
  readonly sequence: number
  readonly toolName: string
  readonly toolInput: Schema.Json
  readonly toolUseId: Option.Option<string>
}

export interface HookLedger {
  readonly received: number
  readonly pendingVersion: number
  readonly started: HashMap.HashMap<ClaudeSessionId, readonly StartedToolCall[]>
  readonly pending: HashMap.HashMap<ClaudeSessionId, PendingPermission>
}

export const emptyHookLedger: HookLedger = {
  received: 0,
  pendingVersion: 0,
  started: HashMap.empty(),
  pending: HashMap.empty(),
}

const startedIn = (ledger: HookLedger, session: ClaudeSessionId) =>
  Option.getOrElse(HashMap.get(ledger.started, session), (): readonly StartedToolCall[] => [])

const withStarted = (
  ledger: HookLedger,
  session: ClaudeSessionId,
  calls: readonly StartedToolCall[],
): HookLedger => ({
  ...ledger,
  started: Arr.isReadonlyArrayNonEmpty(calls)
    ? HashMap.set(ledger.started, session, calls)
    : HashMap.remove(ledger.started, session),
})

const withoutPending = (ledger: HookLedger, session: ClaudeSessionId): HookLedger => ({
  ...ledger,
  pendingVersion: ledger.pendingVersion + 1,
  pending: HashMap.remove(ledger.pending, session),
})

const recordStarted = (ledger: HookLedger, payload: PreToolUsePayload): HookLedger =>
  withStarted(ledger, payload.session_id, [
    ...startedIn(ledger, payload.session_id),
    {
      sequence: ledger.received,
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      toolUseId: payload.tool_use_id,
    },
  ])

const matchingCall = (ledger: HookLedger, payload: PermissionRequestPayload) =>
  Arr.findLast(
    startedIn(ledger, payload.session_id),
    (call) =>
      call.toolName === payload.tool_name && Equal.equals(call.toolInput, payload.tool_input),
  )

const recordPermission = (ledger: HookLedger, payload: PermissionRequestPayload): HookLedger => ({
  ...ledger,
  pendingVersion: ledger.pendingVersion + 1,
  pending: HashMap.set(ledger.pending, payload.session_id, {
    sequence: ledger.received,
    toolName: payload.tool_name,
    toolInput: payload.tool_input,
    toolUseId: Option.map(matchingCall(ledger, payload), (call) => call.toolUseId),
  }),
})

const resolveCalls = (
  ledger: HookLedger,
  session: ClaudeSessionId,
  toolUseIds: readonly string[],
): HookLedger => {
  const isResolved = (toolUseId: string) => Arr.contains(toolUseIds, toolUseId)
  const remaining = withStarted(
    ledger,
    session,
    Arr.filter(startedIn(ledger, session), (call) => !isResolved(call.toolUseId)),
  )

  return pipe(
    HashMap.get(ledger.pending, session),
    Option.filter((pending) => Option.exists(pending.toolUseId, isResolved)),
    Option.match({
      onNone: () => remaining,
      onSome: () => withoutPending(remaining, session),
    }),
  )
}

const applyPayload = (ledger: HookLedger, payload: HookPayload): HookLedger =>
  Match.value(payload).pipe(
    Match.discriminatorsExhaustive('hook_event_name')({
      PreToolUse: (started) => recordStarted(ledger, started),
      PermissionRequest: (request) => recordPermission(ledger, request),
      PostToolUse: (finished) => resolveCalls(ledger, finished.session_id, [finished.tool_use_id]),
      PostToolUseFailure: (failed) => resolveCalls(ledger, failed.session_id, [failed.tool_use_id]),
      PostToolBatch: (batch) =>
        resolveCalls(
          ledger,
          batch.session_id,
          Arr.map(batch.tool_calls, (call) => call.tool_use_id),
        ),
    }),
  )

export const recordHook = (ledger: HookLedger, payload: HookPayload): HookLedger => ({
  ...applyPayload(ledger, payload),
  received: ledger.received + 1,
})

export const pendingPermission = (
  ledger: HookLedger,
  session: ClaudeSessionId,
): Option.Option<PendingPermission> => HashMap.get(ledger.pending, session)

export const dismissBefore = (
  ledger: HookLedger,
  session: ClaudeSessionId,
  position: number,
): HookLedger => {
  const remaining = withStarted(
    ledger,
    session,
    Arr.filter(startedIn(ledger, session), (call) => call.sequence >= position),
  )

  return pipe(
    HashMap.get(ledger.pending, session),
    Option.filter((pending) => pending.sequence < position),
    Option.match({
      onNone: () => remaining,
      onSome: () => withoutPending(remaining, session),
    }),
  )
}
