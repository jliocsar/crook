import * as BunSocketServer from '@effect/platform-bun/BunSocketServer'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as Socket from 'effect/socket/Socket'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { makeEnsureParentDirectory, stateFile } from '@crook/agent/StateDirectory'
import {
  type HookLedger,
  type PendingPermission,
  dismissBefore,
  emptyHookLedger,
  pendingPermissions,
  recordHook,
  retainSessions,
} from '@crook/claude/HookLedger'
import { HookPayloadFromJson } from '@crook/claude/HookPayload'
import type { ClaudeSessionId } from '@crook/domain/Ids'

export const CrookHookSocketPath = stateFile('CROOK_HOOK_SOCKET_PATH', 'hook.sock')

export class HookSocketUnavailable extends Schema.TaggedError<HookSocketUnavailable>()(
  'HookSocketUnavailable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not listen for Claude's hooks on ${this.path}, so crook reads asks from the transcript and the screen only. Check that folder's permissions, or point CROOK_HOOK_SOCKET_PATH elsewhere.`
  }
}

const fromLedger = (ledger: SubscriptionRef.SubscriptionRef<HookLedger>) =>
  HookInbox.of({
    position: Effect.map(SubscriptionRef.get(ledger), (current) => current.received),
    pendingFor: (session) =>
      Effect.map(SubscriptionRef.get(ledger), (current) => pendingPermissions(current, session)),
    dismissBefore: (session, position) =>
      SubscriptionRef.update(ledger, (current) => dismissBefore(current, session, position)),
    retain: (isKept, position) =>
      SubscriptionRef.update(ledger, (current) => retainSessions(current, isKept, position)),
    changes: SubscriptionRef.changes(ledger).pipe(
      Stream.map((current) => current.pendingVersion),
      Stream.changes,
      Stream.drop(1),
      Stream.as(undefined),
    ),
  })

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const ensureParentDirectory = yield* makeEnsureParentDirectory
  const path = yield* CrookHookSocketPath
  const ledger = yield* SubscriptionRef.make(emptyHookLedger)

  const receive = Effect.fn('HookInbox.receive')(function* (socket: Socket.Socket) {
    const pull = yield* Socket.readerBytes(socket)
    const text = yield* Stream.fromEffectRepeat(pull).pipe(
      Stream.flattenArray,
      Stream.decodeText,
      Stream.catchReason('SocketError', 'SocketCloseError', () => Stream.empty),
      Stream.mkString,
    )
    const payload = yield* Schema.decodeEffect(HookPayloadFromJson)(text)

    yield* SubscriptionRef.update(ledger, (current) => recordHook(current, payload))
  }, Effect.scoped)

  const receiveOrIgnore = Effect.fn('HookInbox.receiveOrIgnore')(function* (socket: Socket.Socket) {
    return yield* receive(socket).pipe(
      Effect.catch((error) => Effect.logDebug(`Ignored a hook delivery: ${error.message}`)),
    )
  })

  const listen = Effect.fn('HookInbox.listen')(function* () {
    yield* ensureParentDirectory(path)
    yield* fileSystem.remove(path, { force: true })

    const server = yield* BunSocketServer.make({ path, allowHalfOpen: true })

    yield* server.run(receiveOrIgnore).pipe(Effect.forkScoped)
  })

  yield* listen().pipe(
    Effect.catch((cause) => Effect.logError(new HookSocketUnavailable({ path, cause }).message)),
  )

  return fromLedger(ledger)
})

export class HookInbox extends Context.Service<
  HookInbox,
  {
    readonly position: Effect.Effect<number>
    readonly pendingFor: (session: ClaudeSessionId) => Effect.Effect<readonly PendingPermission[]>
    readonly dismissBefore: (session: ClaudeSessionId, position: number) => Effect.Effect<void>
    readonly retain: (
      isKept: (session: ClaudeSessionId) => boolean,
      position: number,
    ) => Effect.Effect<void>
    readonly changes: Stream.Stream<void>
  }
>()('@crook/agent/HookInbox') {
  static readonly layer = Layer.effect(this, make)

  static readonly layerTest = (ledger: SubscriptionRef.SubscriptionRef<HookLedger>) =>
    Layer.succeed(this, fromLedger(ledger))
}
