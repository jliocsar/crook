import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'

import { linkStateAtom } from '@crook/web/atoms/Hub'
import { connectionView, STARTING_VIEW } from '@crook/web/connection/ConnectionView'

export const connectionAtom = Atom.make((get) =>
  Option.match(AsyncResult.value(get(linkStateAtom)), {
    onNone: () => STARTING_VIEW,
    onSome: connectionView,
  }),
)

export const linkFailureAtom = Atom.make((get) => AsyncResult.cause(get(linkStateAtom)))
