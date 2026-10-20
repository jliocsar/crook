import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'
import * as Socket from 'effect/socket/Socket'

import type { HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { AGENT_PING_INTERVAL } from '@crook/protocol/AgentLink'
import { ClientApi } from '@crook/protocol/ClientApi'
import type { HubStorageFailed, MachineNotInHerd, PaneNotInHerd } from '@crook/protocol/ClientApi'
import { protocolSerialization } from '@crook/protocol/Serialization'

export type ClientApiClient = RpcClient.FromGroup<typeof ClientApi, RpcClientError>

export type MarkSeenRefused = MachineNotInHerd | PaneNotInHerd | HubStorageFailed

export interface HubCalls {
  readonly watchHerd: Stream.Stream<HerdView, HubConnectionLost>
  readonly markSeen: (
    machine: MachineId,
    pane: PaneId,
  ) => Effect.Effect<void, MarkSeenRefused | HubConnectionLost>
}

const SECURE_PAGE_PROTOCOL = 'https:'
const SECURE_SOCKET_PROTOCOL = 'wss:'
const PLAIN_SOCKET_PROTOCOL = 'ws:'

export const HUB_CLIENT_PATH = '/rpc/client'

export class HubConnectionLost extends Schema.TaggedError<HubConnectionLost>()(
  'HubConnectionLost',
  { detail: Schema.String },
) {
  override get message(): string {
    return `The connection to the hub failed (${this.detail}). crook reconnects on its own; if it keeps failing, check that the hub is running and reachable at this address.`
  }
}

export const hubSocketUrl = (page: URL): URL => {
  const socket = new URL(HUB_CLIENT_PATH, page)

  socket.protocol =
    page.protocol === SECURE_PAGE_PROTOCOL ? SECURE_SOCKET_PROTOCOL : PLAIN_SOCKET_PROTOCOL

  return socket
}

const connectionLost = (error: RpcClientError) => new HubConnectionLost({ detail: error.message })

export const callsFrom = (client: ClientApiClient): HubCalls => ({
  watchHerd: client.WatchHerd().pipe(Stream.mapError(connectionLost)),
  markSeen: (machine, pane) =>
    client
      .MarkSeen({ machine, pane })
      .pipe(Effect.catchTag('RpcClientError', (error) => Effect.fail(connectionLost(error)))),
})

export const connectTo = (url: URL): Effect.Effect<HubCalls, never, Scope.Scope> =>
  Layer.build(
    Layer.provide(
      RpcClient.layerProtocolSocket({
        pingInterval: AGENT_PING_INTERVAL,
        retryPolicy: Schedule.recurs(0),
      }),
      [
        Layer.provide(Socket.layerWebSocket(url.href), Socket.layerWebSocketConstructorGlobal),
        protocolSerialization,
      ],
    ),
  ).pipe(
    Effect.flatMap((protocol) => RpcClient.make(ClientApi).pipe(Effect.provide(protocol))),
    Effect.map(callsFrom),
  )

export class HubConnection extends Context.Service<
  HubConnection,
  { readonly open: Effect.Effect<HubCalls, never, Scope.Scope> }
>()('@crook/web/HubConnection') {
  static readonly layer = Layer.sync(this, () =>
    HubConnection.of({ open: connectTo(hubSocketUrl(new URL(window.location.href))) }),
  )
}
