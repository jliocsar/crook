import * as BunSocket from '@effect/platform-bun/BunSocket'
import * as Config from 'effect/Config'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Redacted from 'effect/Redacted'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as RpcClient from 'effect/rpc/RpcClient'
import type { RpcClientError } from 'effect/rpc/RpcClientError'

import { CommandExecutor } from '@crook/agent/CommandExecutor'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { reconnectBackoff, trackConnectionHealth } from '@crook/agent/Reconnect'
import {
  AGENT_PING_INTERVAL,
  AGENT_SOCKET_OPEN_TIMEOUT,
  AgentLink,
  Hello,
} from '@crook/protocol/AgentLink'
import { protocolSerialization } from '@crook/protocol/Serialization'

import packageJson from '../package.json' with { type: 'json' }

export type AgentLinkClient = RpcClient.FromGroup<typeof AgentLink, RpcClientError>

export type HubConnect = Effect.Effect<AgentLinkClient, never, Scope.Scope>

const HUB_AUTHORIZATION_HEADER = 'X-Exedev-Authorization'

export const HUB_RECONNECT_BASE = Duration.millis(77)

export const CrookHubUrl = Config.URL('CROOK_HUB_URL')
export const CrookHubToken = Config.Redacted('CROOK_HUB_TOKEN')
export const CrookMachineLabel = Config.option(Config.NonEmptyString('CROOK_MACHINE_LABEL'))

export const agentVersion = packageJson.version

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
          openTimeout: AGENT_SOCKET_OPEN_TIMEOUT,
          headers: { [HUB_AUTHORIZATION_HEADER]: `Bearer ${Redacted.value(token)}` },
        }),
        protocolSerialization,
      ]),
    ),
  ).pipe(Effect.flatMap((protocol) => RpcClient.make(AgentLink).pipe(Effect.provide(protocol))))

const make = (connect: HubConnect, hello: Hello) =>
  Effect.gen(function* () {
    const sync = yield* MachineStateSync
    const executor = yield* CommandExecutor

    const holdAttach = (client: AgentLinkClient) =>
      client.Attach({ hello }).pipe(
        Stream.mapEffect((routed) =>
          executor.execute(routed.key, routed.command).pipe(
            Effect.result,
            Effect.flatMap((result) => client.CompleteCommand({ id: routed.id, result })),
            Effect.annotateLogs('command', routed.id),
          ),
        ),
        Stream.runDrain,
        Effect.andThen(Effect.fail(new HubAttachEnded())),
      )

    const publishChanges = (client: AgentLinkClient, markHealthy: Effect.Effect<void>) =>
      sync.changes.pipe(
        Stream.buffer({ capacity: 1, strategy: 'sliding' }),
        Stream.mapEffect((state) => client.PublishState({ state })),
        Stream.tap(() => markHealthy),
        Stream.runDrain,
      )

    const session = Effect.fn('HubLink.session')(function* () {
      const client = yield* connect
      const health = yield* trackConnectionHealth

      yield* Effect.all([holdAttach(client), publishChanges(client, health.markHealthy)], {
        concurrency: 'unbounded',
        discard: true,
      }).pipe(
        Effect.catchDefect((cause) => Effect.fail(new HubCallDefected({ cause }))),
        Effect.tapError((error) => Effect.logWarning(error.message)),
        Effect.catch((error) =>
          Effect.flatMap(health.stayedHealthy, (healthy) =>
            healthy ? Effect.void : Effect.fail(error),
          ),
        ),
      )
    }, Effect.scoped)

    yield* session().pipe(
      Effect.retry(reconnectBackoff(HUB_RECONNECT_BASE)),
      Effect.forever,
      Effect.forkScoped,
    )
  })

export const layerWith = (connect: HubConnect, hello: Hello) =>
  Layer.effectDiscard(make(connect, hello))

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* CrookHubUrl
    const token = yield* CrookHubToken
    const label = yield* CrookMachineLabel

    return layerWith(connectTo(url, token), new Hello({ agentVersion, label }))
  }),
)
