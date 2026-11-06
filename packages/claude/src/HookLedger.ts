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
  toolCallFields,
} from '@crook/claude/HookPayload'
import type { ClaudeSessionId } from '@crook/domain/Ids'

export interface ToolCall {
  readonly toolName: string
  readonly toolInput: Schema.Json
}

export interface StartedToolCall extends ToolCall {
  readonly sequence: number
  readonly toolUseId: string
}

export interface PendingPermission extends ToolCall {
  readonly sequence: number
  readonly toolUseId: Option.Option<string>
}

interface FinishedCall extends ToolCall {
  readonly toolUseId: string
}

type SessionRecords<Entry> = HashMap.HashMap<ClaudeSessionId, readonly Entry[]>

export interface HookLedger {
  readonly received: number
  readonly pendingVersion: number
  readonly started: SessionRecords<StartedToolCall>
  readonly pending: SessionRecords<PendingPermission>
}

export const emptyHookLedger: HookLedger = {
  received: 0,
  pendingVersion: 0,
  started: HashMap.empty(),
  pending: HashMap.empty(),
}

const recordsIn = <Entry>(
  records: SessionRecords<Entry>,
  session: ClaudeSessionId,
): readonly Entry[] => Option.getOrElse(HashMap.get(records, session), (): readonly Entry[] => [])

const withRecords = <Entry>(
  records: SessionRecords<Entry>,
  session: ClaudeSessionId,
  kept: readonly Entry[],
): SessionRecords<Entry> =>
  Arr.isReadonlyArrayNonEmpty(kept)
    ? HashMap.set(records, session, kept)
    : HashMap.remove(records, session)

const withStarted = (
  ledger: HookLedger,
  session: ClaudeSessionId,
  calls: readonly StartedToolCall[],
): HookLedger => ({ ...ledger, started: withRecords(ledger.started, session, calls) })

const withPending = (
  ledger: HookLedger,
  session: ClaudeSessionId,
  permissions: readonly PendingPermission[],
): HookLedger => ({
  ...ledger,
  pendingVersion: ledger.pendingVersion + 1,
  pending: withRecords(ledger.pending, session, permissions),
})

const withPendingIfChanged = (
  ledger: HookLedger,
  session: ClaudeSessionId,
  permissions: readonly PendingPermission[],
): HookLedger =>
  permissions.length === recordsIn(ledger.pending, session).length
    ? ledger
    : withPending(ledger, session, permissions)

export const isSameCall = (left: ToolCall) => (right: ToolCall) =>
  left.toolName === right.toolName && Equal.equals(left.toolInput, right.toolInput)

const isUnpaired = (permission: PendingPermission) => Option.isNone(permission.toolUseId)

const pairedIds = (permissions: readonly PendingPermission[]) =>
  Arr.flatMap(permissions, (permission) => Option.toArray(permission.toolUseId))

const recordStarted = (ledger: HookLedger, payload: PreToolUsePayload): HookLedger => {
  const session = payload.session_id
  const pending = recordsIn(ledger.pending, session)
  const call: StartedToolCall = {
    sequence: ledger.received,
    toolName: payload.tool_name,
    toolInput: payload.tool_input,
    toolUseId: payload.tool_use_id,
  }

  return Option.match(
    Arr.findFirstIndex(
      pending,
      (permission) => isUnpaired(permission) && isSameCall(call)(permission),
    ),
    {
      onNone: () => withStarted(ledger, session, [...recordsIn(ledger.started, session), call]),
      onSome: (index) =>
        withPending(
          ledger,
          session,
          pending.map((permission, at) =>
            at === index ? { ...permission, toolUseId: Option.some(call.toolUseId) } : permission,
          ),
        ),
    },
  )
}

const recordPermission = (ledger: HookLedger, payload: PermissionRequestPayload): HookLedger => {
  const session = payload.session_id
  const pending = recordsIn(ledger.pending, session)
  const request: ToolCall = { toolName: payload.tool_name, toolInput: payload.tool_input }
  const claimed = pairedIds(pending)
  const started = Arr.findLast(
    recordsIn(ledger.started, session),
    (call) => isSameCall(request)(call) && !Arr.contains(claimed, call.toolUseId),
  )

  return withPending(ledger, session, [
    ...pending,
    {
      ...request,
      sequence: ledger.received,
      toolUseId: Option.map(started, (call) => call.toolUseId),
    },
  ])
}

const withoutUnpairedCall = (
  permissions: readonly PendingPermission[],
  call: FinishedCall,
): readonly PendingPermission[] =>
  Option.match(
    Arr.findFirstIndex(
      permissions,
      (permission) => isUnpaired(permission) && isSameCall(call)(permission),
    ),
    {
      onNone: () => permissions,
      onSome: (index) => Arr.remove(permissions, index),
    },
  )

const resolveCalls = (
  ledger: HookLedger,
  session: ClaudeSessionId,
  calls: readonly FinishedCall[],
): HookLedger => {
  const finishedIds = Arr.map(calls, (call) => call.toolUseId)
  const isFinished = (toolUseId: string) => Arr.contains(finishedIds, toolUseId)
  const pending = recordsIn(ledger.pending, session)
  const paired = pairedIds(pending)
  const remaining = pipe(
    calls,
    Arr.filter((call) => !Arr.contains(paired, call.toolUseId)),
    Arr.reduce(
      Arr.filter(pending, (permission) => !Option.exists(permission.toolUseId, isFinished)),
      withoutUnpairedCall,
    ),
  )

  return withPendingIfChanged(
    withStarted(
      ledger,
      session,
      Arr.filter(recordsIn(ledger.started, session), (call) => !isFinished(call.toolUseId)),
    ),
    session,
    remaining,
  )
}

const finishedCall = (payload: Schema.Struct.Type<typeof toolCallFields>): FinishedCall => ({
  toolName: payload.tool_name,
  toolInput: payload.tool_input,
  toolUseId: payload.tool_use_id,
})

const applyPayload = (ledger: HookLedger, payload: HookPayload): HookLedger =>
  Match.value(payload).pipe(
    Match.discriminatorsExhaustive('hook_event_name')({
      PreToolUse: (started) => recordStarted(ledger, started),
      PermissionRequest: (request) => recordPermission(ledger, request),
      PostToolUse: (finished) =>
        resolveCalls(ledger, finished.session_id, [finishedCall(finished)]),
      PostToolUseFailure: (failed) =>
        resolveCalls(ledger, failed.session_id, [finishedCall(failed)]),
      PostToolBatch: (batch) =>
        resolveCalls(ledger, batch.session_id, Arr.map(batch.tool_calls, finishedCall)),
    }),
  )

export const recordHook = (ledger: HookLedger, payload: HookPayload): HookLedger => ({
  ...applyPayload(ledger, payload),
  received: ledger.received + 1,
})

export const pendingPermissions = (
  ledger: HookLedger,
  session: ClaudeSessionId,
): readonly PendingPermission[] => recordsIn(ledger.pending, session)

export const dismissBefore = (
  ledger: HookLedger,
  session: ClaudeSessionId,
  position: number,
): HookLedger => {
  const isRecent = (record: { readonly sequence: number }) => record.sequence >= position

  return withPendingIfChanged(
    withStarted(ledger, session, Arr.filter(recordsIn(ledger.started, session), isRecent)),
    session,
    Arr.filter(recordsIn(ledger.pending, session), isRecent),
  )
}

export const retainSessions = (
  ledger: HookLedger,
  isKept: (session: ClaudeSessionId) => boolean,
  position: number,
): HookLedger =>
  pipe(
    [...HashMap.keys(ledger.started), ...HashMap.keys(ledger.pending)],
    Arr.dedupe,
    Arr.filter((session) => !isKept(session)),
    Arr.reduce(ledger, (current, session) => dismissBefore(current, session, position)),
  )
