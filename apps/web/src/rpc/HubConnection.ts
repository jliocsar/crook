import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import type * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as RpcClient from 'effect/rpc/RpcClient'
import { RpcClientError } from 'effect/rpc/RpcClientError'
import * as Socket from 'effect/socket/Socket'

import type { Command, CommandReceipt } from '@crook/domain/Command'
import { herdViews } from '@crook/domain/HerdUpdate'
import type { HerdView } from '@crook/domain/HerdView'
import type { IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'
import type { NotificationEvent, NotificationSettings } from '@crook/domain/Notifications'
import type {
  TranscriptEvent,
  TranscriptPosition,
  TranscriptSource,
  TranscriptTailBytes,
} from '@crook/domain/Transcript'
import { LINK_PING_INTERVAL } from '@crook/protocol/LinkTiming'
import { ClientApi } from '@crook/protocol/ClientApi'
import type {
  HubAccount,
  HubStorageFailed,
  MachineNotInHerd,
  MachineStillConnected,
  PaneNotInHerd,
} from '@crook/protocol/ClientApi'
import type { CommandFailure } from '@crook/protocol/Commands'
import type { TestNotificationFailure } from '@crook/protocol/Hark'
import { AGENT_PATH, CLIENT_PATH, DIAL_REASON_PARAMETER, LinkLoss } from '@crook/protocol/HubRoutes'
import type { DialReason } from '@crook/protocol/HubRoutes'
import { protocolSerialization } from '@crook/protocol/Serialization'
import type { TranscriptFailure } from '@crook/protocol/Transcripts'

export type ClientApiClient = RpcClient.FromGroup<typeof ClientApi, RpcClientError>

export type MarkSeenRefused = MachineNotInHerd | PaneNotInHerd | HubStorageFailed

export type ForgetMachineRefused = MachineNotInHerd | MachineStillConnected | HubStorageFailed

export type SetPinnedRefused = MachineNotInHerd | PaneNotInHerd | HubStorageFailed

export type WatchTranscriptRefused = MachineNotInHerd | PaneNotInHerd | TranscriptFailure

export type HubCallFailed = HubConnectionLost | HubCallDefected

export interface TranscriptRequest {
  readonly machine: MachineId
  readonly source: TranscriptSource
  readonly from: Option.Option<TranscriptPosition>
  readonly tail: Option.Option<TranscriptTailBytes>
}

export interface HubCalls {
  readonly watchHerd: Stream.Stream<HerdView, HubCallFailed>
  readonly markSeen: (
    machine: MachineId,
    pane: PaneId,
  ) => Effect.Effect<void, MarkSeenRefused | HubCallFailed>
  readonly forgetMachine: (
    machine: MachineId,
  ) => Effect.Effect<void, ForgetMachineRefused | HubCallFailed>
  readonly setPinned: (
    machine: MachineId,
    pane: PaneId,
    pinned: boolean,
  ) => Effect.Effect<void, SetPinnedRefused | HubCallFailed>
  readonly watchTranscript: (
    request: TranscriptRequest,
  ) => Stream.Stream<TranscriptEvent, WatchTranscriptRefused | HubCallFailed>
  readonly sendCommand: (
    machine: MachineId,
    key: IdempotencyKey,
    command: Command,
  ) => Effect.Effect<CommandReceipt, CommandFailure | HubCallFailed>
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
  { lost: LinkLoss },
) {
  override get message(): string {
    return 'The connection to the hub failed. crook reconnects on its own; if it keeps failing, check that the hub is running and reachable at this address.'
  }
}

export class HubCallDefected extends Schema.TaggedError<HubCallDefected>()('HubCallDefected', {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return 'A call to the hub failed in a way crook could not read. crook keeps retrying; if it keeps happening, reload crook to pick up the latest build.'
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

export const dialUrl = (socket: URL, reason: DialReason): URL => {
  const dial = new URL(socket)

  dial.searchParams.set(DIAL_REASON_PARAMETER, reason)

  return dial
}

export const linkLossOf = (pingTimedOut: boolean, error: RpcClientError): LinkLoss =>
  pingTimedOut
    ? 'PingTimedOut'
    : Match.value(error.reason).pipe(
        Match.withReturnType<LinkLoss>(),
        Match.tags({
          SocketCloseError: () => 'SocketClosed',
          SocketOpenError: () => 'DialFailed',
          SocketUpgradeError: () => 'DialFailed',
        }),
        Match.orElse(() => 'LinkFailed'),
      )

const callDefected = (cause: unknown) => new HubCallDefected({ cause })

const connectionLost = (pingTimedOut: Effect.Effect<boolean>, error: RpcClientError) =>
  Effect.map(
    pingTimedOut,
    (timedOut) => new HubConnectionLost({ lost: linkLossOf(timedOut, error) }),
  )

export const callsFrom = (
  client: ClientApiClient,
  pingTimedOut: Effect.Effect<boolean>,
): HubCalls => {
  const hubCall = <Success, Failure>(call: Effect.Effect<Success, Failure | RpcClientError>) =>
    call.pipe(
      Effect.catchIf(Schema.is(RpcClientError), (error) =>
        Effect.flatMap(connectionLost(pingTimedOut, error), Effect.fail),
      ),
      Effect.catchDefect((cause) => Effect.fail(callDefected(cause))),
    )

  const hubStream = <Success, Failure>(stream: Stream.Stream<Success, Failure | RpcClientError>) =>
    stream.pipe(
      Stream.catchIf(Schema.is(RpcClientError), (error) =>
        Stream.fromEffect(Effect.flatMap(connectionLost(pingTimedOut, error), Effect.fail)),
      ),
      Stream.catchDefect((cause) => Stream.fail(callDefected(cause))),
    )

  return {
    watchHerd: herdViews(hubStream(client.WatchHerd())),
    markSeen: (machine, pane) => hubCall(client.MarkSeen({ machine, pane })),
    forgetMachine: (machine) => hubCall(client.ForgetMachine({ machine })),
    setPinned: (machine, pane, pinned) => hubCall(client.SetPinned({ machine, pane, pinned })),
    watchTranscript: (request) => hubStream(client.WatchTranscript(request)),
    sendCommand: (machine, key, command) => hubCall(client.SendCommand({ machine, key, command })),
    watchNotificationSettings: hubStream(client.WatchNotificationSettings()),
    setNotificationPref: (event, enabled) =>
      hubCall(client.SetNotificationPref({ event, enabled })),
    sendTestNotification: hubCall(client.SendTestNotification()),
    account: hubCall(client.GetAccount()),
  }
}

export const connectTo = (url: URL): Effect.Effect<HubCalls, never, Scope.Scope> =>
  Effect.gen(function* () {
    const pingTimedOut = yield* Ref.make(false)
    const protocol = yield* Layer.build(
      Layer.provide(
        RpcClient.layerProtocolSocket({
          pingInterval: LINK_PING_INTERVAL,
          retryPolicy: Schedule.recurs(0),
          onPingTimeout: Ref.set(pingTimedOut, true),
        }),
        [
          Layer.provide(Socket.layerWebSocket(url.href), Socket.layerWebSocketConstructorGlobal),
          protocolSerialization,
        ],
      ),
    )
    const client = yield* RpcClient.make(ClientApi).pipe(Effect.provide(protocol))

    return callsFrom(client, Ref.get(pingTimedOut))
  })

export class HubConnection extends Context.Service<
  HubConnection,
  { readonly open: (reason: DialReason) => Effect.Effect<HubCalls, never, Scope.Scope> }
>()('@crook/web/HubConnection') {
  static readonly layer = Layer.sync(this, () => {
    const socket = hubSocketUrl(new URL(window.location.href))

    return HubConnection.of({ open: (reason) => connectTo(dialUrl(socket, reason)) })
  })
}
