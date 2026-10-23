import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'
import * as Atom from 'effect/reactivity/Atom'

import { TranscriptCache } from '@crook/web/cache/TranscriptCache'
import { HubLink } from '@crook/web/rpc/HubLink'

export const hubRuntime = Atom.runtime(Layer.mergeAll(HubLink.layer, TranscriptCache.layer))

export const linkStateAtom = hubRuntime
  .atom(Stream.unwrap(HubLink.useSync((link) => link.changes)))
  .pipe(Atom.keepAlive)
