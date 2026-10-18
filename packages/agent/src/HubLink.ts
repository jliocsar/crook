import * as BunSocket from '@effect/platform-bun/BunSocket'
import * as Clock from 'effect/Clock'
import * as Config from 'effect/Config'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Redacted from 'effect/Redacted'
import * as Ref from 'effect/Ref'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'

import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { AGENT_PING_INTERVAL, AgentLink } from '@crook/protocol/AgentLink'
import { protocolSerialization } from '@crook/protocol/Serialization'

export type AgentLinkClient = RpcClient.FromGroup<typeof AgentLink, RpcClientError>

export type HubConnect = Effect.Effect<AgentLinkClient, never, Scope.Scope>

const HUB_AUTHORIZATION_HEADER = 'X-Exedev-Authorization'

export const HUB_RECONNECT_BASE = Duration.millis(77)

export const CrookHubUrl = Config.URL('CROOK_HUB_URL')
export const CrookHubToken = Config.Redacted('CROOK_HUB_TOKEN')

export class HubAttachEnded extends Schema.TaggedError<HubAttachEnded>()('HubAttachEnded', {}) {
  override get message(): string {
    return 'The hub ended the Attach stream, so it no longer sees this machine as online. crook reconnects on its own; if this keeps happening, check the hub logs.'
  }
}

export class HubCallDefected extends Schema.TaggedError<HubCallDefected>()('HubCallDefected', {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return 'A call to the hub died instead of failing: the hub and this agent disagree on the protocol, or a hub handler crashed. crook reconnects on its own; check that both run the same crook version and read the hub logs.'
  }
}

export const connectTo = (url: URL, token: Redacted.Redacted) =>
  Layer.build(
    RpcClient.layerProtocolSocket({
      pingInterval: AGENT_PING_INTERVAL,
      retryPolicy: Schedule.recurs(0),
    }).pipe(
      Layer.provide([
        BunSocket.layerWebSocket(url.href, {
          headers: { [HUB_AUTHORIZATION_HEADER]: `Bearer ${Redacted.value(token)}` },
        }),
        protocolSerialization,
      ]),
    ),
  ).pipe(Effect.flatMap((protocol) => RpcClient.make(AgentLink).pipe(Effect.provide(protocol))))

const make = (connect: HubConnect) =>
  Effect.gen(function* () {
    const sync = yield* MachineStateSync

    const holdAttach = (client: AgentLinkClient) =>
      client.Attach().pipe(Stream.runDrain, Effect.andThen(Effect.fail(new HubAttachEnded())))

    const publishChanges = (client: AgentLinkClient, markAccepted: Effect.Effect<void>) =>
      sync.changes.pipe(
        Stream.buffer({ capacity: 1, strategy: 'sliding' }),
        Stream.mapEffect((state) => client.PublishState({ state })),
        Stream.tap(() => markAccepted),
        Stream.runDrain,
      )

    const session = Effect.fn('HubLink.session')(function* () {
      const client = yield* connect
      const acceptedAt = yield* Ref.make(Option.none<number>())
      const markAccepted = Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Ref.update(
          acceptedAt,
          Option.orElseSome(() => now),
        ),
      )
      const stayedHealthy = Effect.zipWith(
        Ref.get(acceptedAt),
        Clock.currentTimeMillis,
        (accepted, now) =>
          Option.exists(accepted, (first) => now - first >= Duration.toMillis(AGENT_PING_INTERVAL)),
      )

      yield* Effect.all([holdAttach(client), publishChanges(client, markAccepted)], {
        concurrency: 'unbounded',
        discard: true,
      }).pipe(
        Effect.catchDefect((cause) => Effect.fail(new HubCallDefected({ cause }))),
        Effect.tapError((error) => Effect.logWarning(error.message)),
        Effect.catch((error) =>
          Effect.flatMap(stayedHealthy, (healthy) => (healthy ? Effect.void : Effect.fail(error))),
        ),
      )
    }, Effect.scoped)

    yield* session().pipe(
      Effect.retry(
        Schedule.min([
          Schedule.exponential(HUB_RECONNECT_BASE),
          Schedule.spaced(AGENT_PING_INTERVAL),
        ]),
      ),
      Effect.forever,
      Effect.forkScoped,
    )
  })

export const layerWith = (connect: HubConnect) => Layer.effectDiscard(make(connect))

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* CrookHubUrl
    const token = yield* CrookHubToken

    return layerWith(connectTo(url, token))
  }),
)
