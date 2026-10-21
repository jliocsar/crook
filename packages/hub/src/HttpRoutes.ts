import * as Config from 'effect/Config'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Match from 'effect/Match'
import * as Stream from 'effect/Stream'
import * as HttpRouter from 'effect/http/HttpRouter'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import * as HttpStaticServer from 'effect/http/HttpStaticServer'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as RpcServer from 'effect/rpc/RpcServer'
import type { SqlError } from 'effect/sql/SqlError'

import type { MachineId } from '@crook/domain/Ids'
import { commandAudit } from '@crook/domain/Audit'
import { AuditTrail } from '@crook/hub/AuditTrail'
import type { TranscriptSource } from '@crook/domain/Transcript'
import { CommandRouter } from '@crook/hub/CommandRouter'
import { ExeDevIdentity } from '@crook/hub/ExeDevIdentity'
import { HarkClient } from '@crook/hub/HarkClient'
import { HarkNotifier } from '@crook/hub/HarkNotifier'
import * as HerdActivity from '@crook/hub/HerdActivity'
import { NotificationStore } from '@crook/hub/NotificationStore'
import { SeenTracker } from '@crook/hub/SeenTracker'
import { Herd } from '@crook/hub/Herd'
import { TranscriptRelay } from '@crook/hub/TranscriptRelay'
import { AGENT_PING_INTERVAL, AgentLink } from '@crook/protocol/AgentLink'
import { ClientApi, HubAccount, HubStorageFailed } from '@crook/protocol/ClientApi'
import { AGENT_PATH, CLIENT_PATH, HEALTH_PATH } from '@crook/protocol/HubRoutes'
import { protocolSerialization } from '@crook/protocol/Serialization'

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
  const audit = yield* AuditTrail
  const notifier = yield* HarkNotifier
  const serialization = yield* RpcSerialization.RpcSerialization
  const serveWeb = yield* HttpStaticServer.make({ root: yield* CrookWebRoot, spa: true })

  const admitTranscript = (machine: MachineId, source: TranscriptSource) =>
    Match.value(source).pipe(
      Match.tagsExhaustive({
        PaneTranscript: ({ pane }) => herd.requirePane(machine, pane),
        SubagentTranscript: () => herd.requireMachine(machine),
      }),
    )

  const serveClientAs = (actor: string) =>
    ClientApi.toHandlers({
      WatchHerd: () => herd.view,
      ForgetMachine: ({ machine }) =>
        herd.forget(machine).pipe(
          Effect.catchTag('SqlError', storageFailureToWire),
          audit.audited({
            actor,
            machine,
            idempotencyKey: Option.none(),
            operation: 'ForgetMachine',
            arguments: {},
          }),
        ),
      MarkSeen: ({ machine, pane }) =>
        herd.markSeen(machine, pane).pipe(Effect.catchTag('SqlError', storageFailureToWire)),
      SetPinned: ({ machine, pane, pinned }) =>
        herd.setPinned(machine, pane, pinned).pipe(
          Effect.catchTag('SqlError', storageFailureToWire),
          audit.audited({
            actor,
            machine,
            idempotencyKey: Option.none(),
            operation: 'SetPinned',
            arguments: { pane, pinned },
          }),
        ),
      SendCommand: ({ machine, key, command }) =>
        router.send(machine, key, command).pipe(
          audit.audited({
            actor,
            machine,
            idempotencyKey: Option.some(key),
            ...commandAudit(command),
          }),
        ),
      WatchTranscript: ({ machine, source, from, tail }) =>
        Stream.unwrap(
          Effect.as(
            admitTranscript(machine, source),
            transcripts.watch(machine, source, from, tail),
          ),
        ),
      WatchNotificationSettings: () => notifier.settings,
      SetNotificationPref: ({ event, enabled }) =>
        notifier.setPref(event, enabled).pipe(Effect.catchTag('SqlError', storageFailureToWire)),
      SendTestNotification: () => notifier.sendTest,
      GetAccount: () => Effect.succeed(new HubAccount({ email: actor })),
    }).pipe(
      Effect.flatMap((handlers) =>
        RpcServer.toHttpEffectWebsocket(ClientApi).pipe(Effect.flatten, Effect.provide(handlers)),
      ),
      Effect.provideService(RpcSerialization.RpcSerialization, serialization),
      Effect.annotateLogs('actor', actor),
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
      Effect.flatMap(identity.admitPhoneSocket(request.headers), serveClientAs),
    ),
    HttpRouter.route('GET', '/*', (request) =>
      Effect.andThen(identity.admitPhonePage(request.headers), serveWeb),
    ),
  ]
})

const notifications = Layer.provideMerge(
  HerdActivity.layerWithoutDependencies,
  HarkNotifier.layerWithoutDependencies,
).pipe(Layer.provide([HarkClient.layer, NotificationStore.layer, SeenTracker.layer]))

const herdServices = Layer.mergeAll(Herd.layer, CommandRouter.layer, AuditTrail.layer)

export const layer = HttpRouter.addAll(routes).pipe(
  Layer.provide([
    Layer.provideMerge(notifications, herdServices),
    TranscriptRelay.layer,
    ExeDevIdentity.layer,
    protocolSerialization,
  ]),
)
