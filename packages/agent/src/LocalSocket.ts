import * as BunSocketServer from '@effect/platform-bun/BunSocketServer'
import type { NonEmptyReadonlyArray } from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import type * as Socket from 'effect/socket/Socket'
import * as Stream from 'effect/Stream'

import { makeEnsureParentDirectory } from '@crook/agent/StateDirectory'

export interface LocalSocketOptions {
  readonly allowHalfOpen: boolean
}

export const serveLocalSocket = Effect.fn('LocalSocket.serve')(function* <Requirements>(
  path: string,
  handle: (socket: Socket.Socket) => Effect.Effect<void, never, Requirements>,
  options: LocalSocketOptions,
) {
  const fileSystem = yield* FileSystem.FileSystem
  const ensureParentDirectory = yield* makeEnsureParentDirectory

  yield* ensureParentDirectory(path)
  yield* fileSystem.remove(path, { force: true })

  const server = yield* BunSocketServer.make({ path, allowHalfOpen: options.allowHalfOpen })

  yield* server.run(handle).pipe(Effect.forkScoped)
})

export const readAllText = (
  pull: Effect.Effect<NonEmptyReadonlyArray<Uint8Array>, Socket.SocketError>,
) =>
  Stream.fromEffectRepeat(pull).pipe(
    Stream.flattenArray,
    Stream.decodeText,
    Stream.catchReason('SocketError', 'SocketCloseError', () => Stream.empty),
    Stream.mkString,
  )
