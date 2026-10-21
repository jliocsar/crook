import * as Config from 'effect/Config'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Stream from 'effect/Stream'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as HttpStaticServer from 'effect/http/HttpStaticServer'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as RpcServer from 'effect/rpc/RpcServer'
import type { SqlError } from 'effect/sql/SqlError'

import type { MachineId } from '@crook/domain/Ids'
import type { TranscriptSource } from '@crook/domain/Transcript'
import { CommandRouter } from '@crook/hub/CommandRouter'
import { ExeDevIdentity } from '@crook/hub/ExeDevIdentity'
import { Herd } from '@crook/hub/Herd'
import { TranscriptRelay } from '@crook/hub/TranscriptRelay'
import { AGENT_PING_INTERVAL, AgentLink } from '@crook/protocol/AgentLink'
import { ClientApi, HubStorageFailed } from '@crook/protocol/ClientApi'
import { protocolSerialization } from '@crook/protocol/Serialization'

export const AGENT_PATH = '/rpc/agent'
export const CLIENT_PATH = '/rpc/client'
export const HEALTH_PATH = '/health'
export const SOCKET_SILENCE_TIMEOUT = Duration.times(AGENT_PING_INTERVAL, 2)

export const CrookWebRoot = Config.String('CROOK_WEB_ROOT')

export const socketOptions = {
  sendPings: false,
  idleTimeout: Duration.toSeconds(SOCKET_SILENCE_TIMEOUT),
}

const storageFailureToWire = (error: SqlError) =>
  Effect.fail(new HubStorageFailed({ detail: error.message }))

const routes = Effect.gen(function* () {
  const herd = yield* Herd
  const router = yield* CommandRouter
  const transcripts = yield* TranscriptRelay
  const identity = yield* ExeDevIdentity
  const serialization = yield* RpcSerialization.RpcSerialization
  const serveWeb = yield* HttpStaticServer.make({ root: yield* CrookWebRoot, spa: true })

  const admitTranscript = (machine: MachineId, source: TranscriptSource) =>
    Match.value(source).pipe(
      Match.tagsExhaustive({
        PaneTranscript: ({ pane }) => herd.requirePane(machine, pane),
        SubagentTranscript: () => herd.requireMachine(machine),
      }),
    )

  const clientHandlers = yield* ClientApi.toHandlers({
    WatchHerd: () => herd.view,
    ForgetMachine: ({ machine }) =>
      herd.forget(machine).pipe(Effect.catchTag('SqlError', storageFailureToWire)),
    MarkSeen: ({ machine, pane }) =>
      herd.markSeen(machine, pane).pipe(Effect.catchTag('SqlError', storageFailureToWire)),
    SendCommand: ({ machine, key, command }) => router.send(machine, key, command),
    WatchTranscript: ({ machine, source, from }) =>
      Stream.unwrap(
        Effect.as(admitTranscript(machine, source), transcripts.watch(machine, source, from)),
      ),
  })
  const serveClients = yield* RpcServer.toHttpEffectWebsocket(ClientApi).pipe(
    Effect.provide(clientHandlers),
  )

  const serveAgentAs = (machine: MachineId) =>
    AgentLink.toHandlers({
      Attach: ({ hello }) =>
        Stream.merge(Stream.fromEffectDrain(herd.hold(machine, hello)), router.attach(machine)),
      PublishState: ({ state }) => herd.publish(machine, state),
      CompleteCommand: ({ id, result }) => router.complete(machine, id, result),
      TranscriptDemands: () => transcripts.demands(machine),
      PublishTranscript: ({ watch, update }) => transcripts.publish(machine, watch, update),
    }).pipe(
      Effect.flatMap((handlers) =>
        RpcServer.toHttpEffectWebsocket(AgentLink).pipe(Effect.flatten, Effect.provide(handlers)),
      ),
      Effect.provideService(RpcSerialization.RpcSerialization, serialization),
      Effect.annotateLogs('machine', machine),
    )

  return [
    HttpRouter.route('GET', HEALTH_PATH, HttpServerResponse.text('ok')),
    HttpRouter.route('GET', AGENT_PATH, (request) =>
      Effect.flatMap(identity.admitAgent(request.headers), serveAgentAs),
    ),
    HttpRouter.route('GET', CLIENT_PATH, (request) =>
      Effect.andThen(identity.admitPhoneSocket(request.headers), serveClients),
    ),
    HttpRouter.route('GET', '/*', (request) =>
      Effect.andThen(identity.admitPhonePage(request.headers), serveWeb),
    ),
  ]
})

export const layer = HttpRouter.addAll(routes).pipe(
  Layer.provide([
    Herd.layer,
    CommandRouter.layer,
    TranscriptRelay.layer,
    ExeDevIdentity.layer,
    protocolSerialization,
  ]),
)
