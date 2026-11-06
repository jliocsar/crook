import * as BunHttpServer from '@effect/platform-bun/BunHttpServer'
import * as Config from 'effect/Config'
import * as Duration from 'effect/Duration'
import * as Layer from 'effect/Layer'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
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
import { LINK_PING_INTERVAL } from '@crook/protocol/LinkTiming'
import { protocolSerialization } from '@crook/protocol/Serialization'

export const SOCKET_SILENCE_TIMEOUT = Duration.times(LINK_PING_INTERVAL, 2)

export const socketOptions = {
  sendPings: false,
  idleTimeout: Duration.toSeconds(SOCKET_SILENCE_TIMEOUT),
}

const harkClient = Layer.provide(HarkClient.layer, FetchHttpClient.layer)

export const herdServices = Layer.provideMerge(
  Layer.mergeAll(Herd.layer, CommandRouter.layer, AuditTrail.layer),
  HerdStore.layer,
)

const notifications = Layer.provideMerge(HerdActivity.layer, HarkNotifier.layer).pipe(
  Layer.provide([harkClient, NotificationStore.layer]),
)

export const routes = Layer.provide(HttpRoutes.layer, [
  Layer.provideMerge(notifications, herdServices),
  TranscriptRelay.layer,
  ExeDevIdentity.layer,
  protocolSerialization,
])

const server = BunHttpServer.layerConfig({
  port: Config.Port('CROOK_HUB_PORT'),
  gracefulShutdownTimeout: Config.succeed(Duration.zero),
  websocket: Config.succeed(socketOptions),
})

export const layer = HttpRouter.serve(routes).pipe(Layer.provide([server, Database.layer]))
