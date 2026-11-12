import type * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Match from 'effect/Match'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as HttpRouter from 'effect/http/HttpRouter'
import type * as HttpServerRequest from 'effect/http/HttpServerRequest'
import * as HttpServerResponse from 'effect/http/HttpServerResponse'
import type * as Rpc from 'effect/rpc/Rpc'
import type * as RpcGroup from 'effect/rpc/RpcGroup'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'
import * as RpcServer from 'effect/rpc/RpcServer'
import type { SqlError } from 'effect/sql/SqlError'

import {
  AttachmentDigest,
  attachmentsOf,
  type Command,
  takesAttachments,
} from '@crook/domain/Command'
import { herdUpdates } from '@crook/domain/HerdUpdate'
import { MachineId } from '@crook/domain/Ids'
import { commandAudit } from '@crook/domain/Audit'
import { AuditTrail } from '@crook/hub/AuditTrail'
import type { TranscriptSource } from '@crook/domain/Transcript'
import { CommandRouter } from '@crook/hub/CommandRouter'
import { ExeDevIdentity } from '@crook/hub/ExeDevIdentity'
import { HarkNotifier } from '@crook/hub/HarkNotifier'
import * as StaticWeb from '@crook/hub/StaticWeb'
import { Herd } from '@crook/hub/Herd'
import { TranscriptRelay } from '@crook/hub/TranscriptRelay'
import { UploadNotHeld, UploadRequestInvalid, Uploads } from '@crook/hub/Uploads'
import { AgentLink } from '@crook/protocol/AgentLink'
import { ClientApi, HubAccount, HubStorageFailed } from '@crook/protocol/ClientApi'
import { AttachmentsUnsupported, MachineOffline } from '@crook/protocol/Commands'
import {
  AGENT_PATH,
  CLIENT_PATH,
  DIAL_REASON_PARAMETER,
  DialReason,
  HEALTH_PATH,
  UPLOAD_MACHINE_PARAMETER,
  UPLOADS_PATH,
} from '@crook/protocol/HubRoutes'

const storageFailureToWire = (error: SqlError) =>
  Effect.andThen(
    Effect.logError(
      `A client's call failed because the hub could not write to its database, so nothing changed: ${error.message}. Check the disk and the file at CROOK_HUB_DATABASE_PATH.`,
    ),
    Effect.fail(new HubStorageFailed({ detail: error.message })),
  )

const NO_CONTENT = 204
const UPLOAD_ROUTE = `${UPLOADS_PATH}/:digest`
const OCTET_STREAM = 'application/octet-stream'
const REQUEST_BASE = 'http://hub'
const UNKNOWN_DIAL_REASON = 'unknown'

const invalidUpload = (reason: string) => () => new UploadRequestInvalid({ reason })

const digestParameter = HttpRouter.params.pipe(
  Effect.flatMap((params) =>
    Schema.decodeUnknownEffect(AttachmentDigest)(params['digest']).pipe(
      Effect.mapError(invalidUpload('its name is not a sha-256 digest')),
    ),
  ),
)

const machineParameter = (url: string) =>
  Schema.decodeUnknownEffect(MachineId)(
    new URL(url, REQUEST_BASE).searchParams.get(UPLOAD_MACHINE_PARAMETER),
  ).pipe(Effect.mapError(invalidUpload('it names no machine')))

const dialReasonOf = (url: string) =>
  Option.getOrElse(
    Schema.decodeUnknownOption(DialReason)(
      new URL(url, REQUEST_BASE).searchParams.get(DIAL_REASON_PARAMETER),
    ),
    () => UNKNOWN_DIAL_REASON,
  )

const routes = Effect.gen(function* () {
  const herd = yield* Herd
  const router = yield* CommandRouter
  const transcripts = yield* TranscriptRelay
  const identity = yield* ExeDevIdentity
  const audit = yield* AuditTrail
  const notifier = yield* HarkNotifier
  const serialization = yield* RpcSerialization.RpcSerialization
  const serveWeb = yield* StaticWeb.make(StaticWeb.thisBundle)
  const uploads = yield* Uploads

  const admitAttachments = (machine: MachineId, command: Command) =>
    attachmentsOf(command).length === 0
      ? Effect.void
      : herd.agentVersionOf(machine).pipe(
          Effect.mapError(() => new MachineOffline({ machine })),
          Effect.filterOrFail(takesAttachments, () => new AttachmentsUnsupported({ machine })),
        )

  const receiveUpload = Effect.fn('HttpRoutes.receiveUpload')(function* (
    request: HttpServerRequest.HttpServerRequest,
  ) {
    yield* identity.admitPhoneSocket(request.headers)

    const digest = yield* digestParameter
    const machine = yield* machineParameter(request.url)

    yield* herd
      .requireMachine(machine)
      .pipe(Effect.mapError(invalidUpload('its machine is not in the herd')))

    const body = yield* request.arrayBuffer.pipe(
      Effect.mapError(invalidUpload('its body could not be read')),
    )

    yield* uploads.put(machine, digest, new Uint8Array(body))

    return HttpServerResponse.empty({ status: NO_CONTENT })
  })

  const serveUpload = Effect.fn('HttpRoutes.serveUpload')(function* (
    request: HttpServerRequest.HttpServerRequest,
  ) {
    const machine = yield* identity.admitAgent(request.headers)
    const digest = yield* digestParameter
    const bytes = yield* uploads.take(machine, digest)

    return yield* Option.match(bytes, {
      onNone: () => Effect.fail(new UploadNotHeld()),
      onSome: (found) =>
        Effect.succeed(HttpServerResponse.uint8Array(found, { contentType: OCTET_STREAM })),
    })
  })

  const admitTranscript = (machine: MachineId, source: TranscriptSource) =>
    Match.value(source).pipe(
      Match.tagsExhaustive({
        PaneTranscript: ({ pane }) => herd.requirePane(machine, pane),
        SubagentTranscript: () => herd.requireMachine(machine),
      }),
    )

  const serveGroup = <Rpcs extends Rpc.Any, Failure, Needs>(
    group: RpcGroup.RpcGroup<Rpcs>,
    logAnnotations: Record<string, string>,
    handlers: Effect.Effect<Context.Context<Rpc.ToHandler<Rpcs>>, Failure, Needs>,
  ) =>
    handlers.pipe(
      Effect.flatMap((context) =>
        RpcServer.toHttpEffectWebsocket(group).pipe(Effect.flatten, Effect.provide(context)),
      ),
      Effect.provideService(RpcSerialization.RpcSerialization, serialization),
      Effect.annotateLogs(logAnnotations),
    )

  const serveClientAs = (actor: string, dialReason: string) =>
    serveGroup(
      ClientApi,
      { actor, dialReason },
      ClientApi.toHandlers({
        WatchHerd: () => herdUpdates(herd.view),
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
          Effect.andThen(
            admitAttachments(machine, command),
            router.send(machine, key, command),
          ).pipe(
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
      }),
    )

  const serveAgentAs = (machine: MachineId) =>
    Effect.flatMap(
      Effect.all([transcripts.linkFor(machine), router.linkFor(machine)]),
      ([link, commands]) =>
        serveGroup(
          AgentLink,
          { machine },
          AgentLink.toHandlers({
            Attach: ({ hello }) =>
              Stream.merge(Stream.fromEffectDrain(herd.hold(machine, hello)), commands.attach),
            PublishState: ({ state }) => commands.publish(state, herd.publish(machine, state)),
            CompleteCommand: ({ id, result }) => router.complete(machine, id, result),
            TranscriptDemands: () => link.demands,
            PublishTranscript: ({ watch, update }) => link.publish(watch, [update]),
            PublishTranscriptBatch: ({ watch, updates }) => link.publish(watch, updates),
          }),
        ),
    )

  return [
    HttpRouter.route('GET', HEALTH_PATH, HttpServerResponse.text('ok')),
    HttpRouter.route('GET', AGENT_PATH, (request) =>
      Effect.flatMap(identity.admitAgent(request.headers), serveAgentAs),
    ),
    HttpRouter.route('GET', CLIENT_PATH, (request) =>
      Effect.flatMap(identity.admitPhoneSocket(request.headers), (actor) => {
        const dialReason = dialReasonOf(request.url)

        return Effect.andThen(
          Effect.logInfo('A phone connected').pipe(Effect.annotateLogs({ dialReason })),
          serveClientAs(actor, dialReason),
        )
      }),
    ),
    HttpRouter.route('PUT', UPLOAD_ROUTE, receiveUpload),
    HttpRouter.route('GET', UPLOAD_ROUTE, serveUpload),
    HttpRouter.route('GET', '/*', (request) =>
      Effect.andThen(identity.admitPhonePage(request.headers), serveWeb),
    ),
  ]
})

export const layer = HttpRouter.addAll(routes)
