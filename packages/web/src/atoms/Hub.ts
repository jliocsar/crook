import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'
import * as Atom from 'effect/reactivity/Atom'

import { HubLink } from '@crook/web/rpc/HubLink'

export const hubRuntime = Atom.runtime(HubLink.layer)

export const linkStateAtom = hubRuntime
  .atom(
    Stream.unwrap(
      Effect.gen(function* () {
        const link = yield* HubLink

        return link.changes
      }),
    ),
  )
  .pipe(Atom.keepAlive)
