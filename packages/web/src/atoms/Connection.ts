import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'

import { linkStateAtom } from '@crook/web/atoms/Hub'
import {
  allowsActions,
  connectionView,
  dimsContent,
  isConnected,
  isVerified,
  STARTING_VIEW,
} from '@crook/web/connection/ConnectionView'
import { COLD_START, linkMachine } from '@crook/web/rpc/HubLinkState'
import { stateMark } from '@crook/web/machine/Machine'

const linkValueAtom = Atom.make((get) => AsyncResult.value(get(linkStateAtom)))

export const connectionAtom = Atom.make((get) =>
  Option.match(get(linkValueAtom), { onNone: () => STARTING_VIEW, onSome: connectionView }),
).pipe(Atom.withEquality(Equal.equals))

export const linkMarkAtom = Atom.make((get) =>
  stateMark(
    linkMachine,
    Option.match(get(linkValueAtom), {
      onNone: () => COLD_START,
      onSome: (state) => state.status,
    }),
  ),
).pipe(Atom.withEquality(Equal.equals))

export const linkAnsweredAtom = Atom.make((get) => Option.isSome(get(linkValueAtom)))

export const canActAtom = Atom.make((get) => allowsActions(get(connectionAtom)))

export const dimsContentAtom = Atom.make((get) => dimsContent(get(connectionAtom)))

export const isVerifiedAtom = Atom.make((get) => isVerified(get(connectionAtom)))

export const isConnectedAtom = Atom.make((get) => isConnected(get(connectionAtom)))

export const linkFailureAtom = Atom.make((get) => AsyncResult.cause(get(linkStateAtom)))
