import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as Atom from 'effect/reactivity/Atom'

import { HerdCache } from '@crook/web/cache/HerdCache'
import { TranscriptCache } from '@crook/web/cache/TranscriptCache'
import { HubConnection } from '@crook/web/rpc/HubConnection'
import { HubLink } from '@crook/web/rpc/HubLink'
import { PageSignals } from '@crook/web/rpc/PageSignals'
import { SessionCheck } from '@crook/web/rpc/SessionCheck'

const sessionCheck = Layer.provide(SessionCheck.layer, FetchHttpClient.layer)

const browserServices = Layer.mergeAll(
  HubConnection.layer,
  HerdCache.layer,
  PageSignals.layer,
  sessionCheck,
)

export const hubRuntime = Atom.runtime(
  Layer.provide(Layer.mergeAll(HubLink.layer, TranscriptCache.layer), browserServices),
)

export const linkStateAtom = hubRuntime
  .atom(Stream.unwrap(HubLink.useSync((link) => link.changes)))
  .pipe(Atom.keepAlive)
