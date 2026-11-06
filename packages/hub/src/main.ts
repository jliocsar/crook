import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as BunServices from '@effect/platform-bun/BunServices'
import * as Command from 'effect/cli/Command'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'

import { hubVersion } from '@crook/hub/Herd'
import * as HubDaemon from '@crook/hub/HubDaemon'

const crookHub = Command.make('crook-hub', {}, () => Layer.launch(HubDaemon.layer)).pipe(
  Command.withDescription(
    'Serve the herd to the phone and the agents. Configured through CROOK_HUB_PORT, CROOK_OWNER_EMAIL, CROOK_HUB_ORIGIN, CROOK_HUB_DATABASE_PATH, the optional CROOK_HUB_HARK_TOKEN and, to serve a web build other than the embedded one, CROOK_WEB_ROOT.',
  ),
)

BunRuntime.runMain(
  // oxlint-disable-next-line effecttsgo/strict-effect-provide
  Command.run(crookHub, { version: hubVersion }).pipe(Effect.provide(BunServices.layer)),
)
