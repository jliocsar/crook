import * as BunSocket from '@effect/platform-bun/BunSocket'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Socket from 'effect/socket/Socket'
import * as Stdio from 'effect/Stdio'
import * as Stream from 'effect/Stream'

import { CrookHookSocketPath } from '@crook/agent/HookInbox'

const SLOWEST_MEASURED_DELIVERY = Duration.millis(15.139)
const HOOK_DELIVERY_TIMEOUT = Duration.times(SLOWEST_MEASURED_DELIVERY, 10)

const deliverHook = Effect.fn('HookForwarder.deliverHook')(function* (
  path: string,
  payload: readonly Uint8Array[],
) {
  const socket = yield* BunSocket.makeNet({ path })

  return yield* Stream.fromIterable(payload).pipe(
    Stream.pipeThroughChannel(Socket.toChannel(socket)),
    Stream.catchReason('SocketError', 'SocketCloseError', () => Stream.empty),
    Stream.runDrain,
  )
})

export const forwardHook = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  const path = yield* CrookHookSocketPath
  const payload = yield* stdio.stdin.pipe(Stream.runCollect)

  yield* deliverHook(path, payload).pipe(Effect.timeout(HOOK_DELIVERY_TIMEOUT))
}).pipe(
  Effect.catchCause((cause) => Effect.logDebug('Dropped a hook payload', cause)),
  Effect.withSpan('HookForwarder.forwardHook'),
)
