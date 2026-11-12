import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import * as Stream from 'effect/Stream'

import { OpenedAgents } from '@crook/web/cache/OpenedAgents'

export const openedRuntime = Atom.runtime(OpenedAgents.layer)

export const openedTimesAtom = openedRuntime
  .atom(Stream.unwrap(OpenedAgents.useSync((opened) => opened.times)))
  .pipe(Atom.keepAlive)

export const loadedOpenedTimesAtom = Atom.make((get) => AsyncResult.value(get(openedTimesAtom)))
