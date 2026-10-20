import * as BunHttpServer from '@effect/platform-bun/BunHttpServer'
import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as Config from 'effect/Config'
import * as Duration from 'effect/Duration'
import * as Layer from 'effect/Layer'
import * as HttpRouter from 'effect/http/HttpRouter'

import * as Database from '@crook/hub/Database'
import * as HttpRoutes from '@crook/hub/HttpRoutes'

const CrookHubPort = Config.Port('CROOK_HUB_PORT')

const server = BunHttpServer.layerConfig({
  port: CrookHubPort,
  gracefulShutdownTimeout: Config.succeed(Duration.zero),
  websocket: Config.succeed(HttpRoutes.socketOptions),
})

BunRuntime.runMain(
  Layer.launch(HttpRouter.serve(HttpRoutes.layer).pipe(Layer.provide([server, Database.layer]))),
)
