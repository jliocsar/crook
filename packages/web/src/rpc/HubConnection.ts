import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as RpcClient from 'effect/rpc/RpcClient'
import { RpcClientError } from 'effect/rpc/RpcClientError'
import * as Socket from 'effect/socket/Socket'

import type { HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import type { NotificationEvent, NotificationSettings } from '@crook/domain/Notifications'
import { AGENT_PING_INTERVAL } from '@crook/protocol/AgentLink'
import { ClientApi } from '@crook/protocol/ClientApi'
import type {
  HubAccount,
  HubStorageFailed,
  MachineNotInHerd,
  MachineStillConnected,
  PaneNotInHerd,
} from '@crook/protocol/ClientApi'
import type { TestNotificationFailure } from '@crook/protocol/Hark'
import { AGENT_PATH, CLIENT_PATH } from '@crook/protocol/HubRoutes'
import { protocolSerialization } from '@crook/protocol/Serialization'

export type ClientApiClient = RpcClient.FromGroup<typeof ClientApi, RpcClientError>

export type MarkSeenRefused = MachineNotInHerd | PaneNotInHerd | HubStorageFailed

export type ForgetMachineRefused = MachineNotInHerd | MachineStillConnected | HubStorageFailed

export type HubCallFailed = HubConnectionLost | HubCallDefected

export interface HubCalls {
  readonly watchHerd: Stream.Stream<HerdView, HubCallFailed>
  readonly markSeen: (
    machine: MachineId,
    pane: PaneId,
  ) => Effect.Effect<void, MarkSeenRefused | HubCallFailed>
  readonly forgetMachine: (
    machine: MachineId,
  ) => Effect.Effect<void, ForgetMachineRefused | HubCallFailed>
  readonly watchNotificationSettings: Stream.Stream<NotificationSettings, HubCallFailed>
  readonly setNotificationPref: (
    event: NotificationEvent,
    enabled: boolean,
  ) => Effect.Effect<void, HubStorageFailed | HubCallFailed>
  readonly sendTestNotification: Effect.Effect<void, TestNotificationFailure | HubCallFailed>
  readonly account: Effect.Effect<HubAccount, HubCallFailed>
}

const SECURE_PAGE_PROTOCOL = 'https:'
const SECURE_SOCKET_PROTOCOL = 'wss:'
const PLAIN_SOCKET_PROTOCOL = 'ws:'

export class HubConnectionLost extends Schema.TaggedError<HubConnectionLost>()(
  'HubConnectionLost',
  { detail: Schema.String },
) {
  override get message(): string {
    return `The connection to the hub failed (${this.detail}). crook reconnects on its own; if it keeps failing, check that the hub is running and reachable at this address.`
  }
}

export class HubCallDefected extends Schema.TaggedError<HubCallDefected>()('HubCallDefected', {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return 'A call to the hub died instead of failing: the hub sent something this build of crook cannot read, or a hub handler crashed. crook keeps retrying; if it keeps happening, reload crook to pick up the build the hub serves, and read the hub logs.'
  }
}

const socketUrlOnPage = (path: string, page: URL): URL => {
  const socket = new URL(path, page)

  socket.protocol =
    page.protocol === SECURE_PAGE_PROTOCOL ? SECURE_SOCKET_PROTOCOL : PLAIN_SOCKET_PROTOCOL

  return socket
}

export const hubSocketUrl = (page: URL): URL => socketUrlOnPage(CLIENT_PATH, page)

export const agentSocketUrl = (page: URL): URL => socketUrlOnPage(AGENT_PATH, page)

const connectionLost = (error: RpcClientError) => new HubConnectionLost({ detail: error.message })

const callDefected = (cause: unknown) => new HubCallDefected({ cause })

const hubCall = <Success, Failure>(call: Effect.Effect<Success, Failure | RpcClientError>) =>
  call.pipe(
    Effect.catchIf(Schema.is(RpcClientError), (error) => Effect.fail(connectionLost(error))),
    Effect.catchDefect((cause) => Effect.fail(callDefected(cause))),
  )

const hubStream = <Success, Failure>(stream: Stream.Stream<Success, Failure | RpcClientError>) =>
  stream.pipe(
    Stream.catchIf(Schema.is(RpcClientError), (error) => Stream.fail(connectionLost(error))),
    Stream.catchDefect((cause) => Stream.fail(callDefected(cause))),
  )

export const callsFrom = (client: ClientApiClient): HubCalls => ({
  watchHerd: hubStream(client.WatchHerd()),
  markSeen: (machine, pane) => hubCall(client.MarkSeen({ machine, pane })),
  forgetMachine: (machine) => hubCall(client.ForgetMachine({ machine })),
  watchNotificationSettings: hubStream(client.WatchNotificationSettings()),
  setNotificationPref: (event, enabled) => hubCall(client.SetNotificationPref({ event, enabled })),
  sendTestNotification: hubCall(client.SendTestNotification()),
  account: hubCall(client.GetAccount()),
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
