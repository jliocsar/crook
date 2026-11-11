import * as BunHttpServer from '@effect/platform-bun/BunHttpServer'
import * as Config from 'effect/Config'
import * as Duration from 'effect/Duration'
import * as Layer from 'effect/Layer'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import type * as HttpClient from 'effect/http/HttpClient'
import * as HttpRouter from 'effect/http/HttpRouter'

import { AuditTrail } from '@crook/hub/AuditTrail'
import { CommandRouter } from '@crook/hub/CommandRouter'
import * as Database from '@crook/hub/Database'
import { ExeDevIdentity } from '@crook/hub/ExeDevIdentity'
import { HarkClient } from '@crook/hub/HarkClient'
import { HarkNotifier } from '@crook/hub/HarkNotifier'
import { Herd } from '@crook/hub/Herd'
import * as HerdActivity from '@crook/hub/HerdActivity'
import { HerdStore } from '@crook/hub/HerdStore'
import * as HttpRoutes from '@crook/hub/HttpRoutes'
import { NotificationStore } from '@crook/hub/NotificationStore'
import { TranscriptRelay } from '@crook/hub/TranscriptRelay'
import { Uploads } from '@crook/hub/Uploads'
import { LINK_PING_INTERVAL } from '@crook/protocol/LinkTiming'
import { protocolSerialization } from '@crook/protocol/Serialization'

export const SOCKET_SILENCE_TIMEOUT = Duration.times(LINK_PING_INTERVAL, 2)

export const socketOptions = {
  sendPings: false,
  idleTimeout: Duration.toSeconds(SOCKET_SILENCE_TIMEOUT),
}

export const herdServices = Layer.provideMerge(
  Layer.mergeAll(Herd.layer, CommandRouter.layer, AuditTrail.layer),
  HerdStore.layer,
)

const notificationsOver = (hark: Layer.Layer<HttpClient.HttpClient>) =>
  Layer.provideMerge(HerdActivity.layer, HarkNotifier.layer).pipe(
    Layer.provide([Layer.provide(HarkClient.layer, hark), NotificationStore.layer]),
  )

export const routesOver = (hark: Layer.Layer<HttpClient.HttpClient>) =>
  Layer.provide(HttpRoutes.layer, [
    Layer.provideMerge(notificationsOver(hark), herdServices),
    TranscriptRelay.layer,
    Uploads.layer,
    ExeDevIdentity.layer,
    protocolSerialization,
  ])

const routes = routesOver(FetchHttpClient.layer)

const server = BunHttpServer.layerConfig({
  port: Config.Port('CROOK_HUB_PORT'),
  gracefulShutdownTimeout: Config.succeed(Duration.zero),
  websocket: Config.succeed(socketOptions),
})

export const layer = HttpRouter.serve(routes).pipe(Layer.provide([server, Database.layer]))
