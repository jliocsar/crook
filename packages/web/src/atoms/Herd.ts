import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'

import { herdNeedsYouCount, isSeen } from '@crook/domain/AgentPriority'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { hubRuntime, linkStateAtom } from '@crook/web/atoms/Hub'
import { findAgent, herdLayout } from '@crook/web/herd/HerdLayout'
import { HubLink } from '@crook/web/rpc/HubLink'

export class OpenedAgent extends Data.Class<{
  readonly machine: MachineId
  readonly pane: PaneId
}> {}

export const herdAtom = Atom.make((get) =>
  Option.flatMap(AsyncResult.value(get(linkStateAtom)), (state) => state.herd),
)

export const herdViewAtom = Atom.make((get) =>
  Option.map(get(herdAtom), (snapshot) => snapshot.view),
)

export const herdLayoutAtom = Atom.make((get) =>
  Option.map(get(herdAtom), (snapshot) => herdLayout(snapshot.view)),
)

export const needsYouAtom = Atom.make((get) =>
  Option.match(get(herdAtom), {
    onNone: () => 0,
    onSome: (snapshot) => herdNeedsYouCount(snapshot.view),
  }),
)

export const resyncAtom = hubRuntime.fn(() => HubLink.use((link) => link.resync))

const unseenWhileLive = (opened: OpenedAgent, get: Atom.AtomContext) =>
  pipe(
    get(herdAtom),
    Option.filter(() => get(connectionAtom).canAct),
    Option.flatMap((snapshot) => findAgent(snapshot.view, opened.machine, opened.pane)),
    Option.filter(({ herdMachine, row }) => !isSeen(herdMachine)(row)),
  )

const unseenWhileLiveAtom = Atom.family((opened: OpenedAgent) =>
  Atom.make((get) => Option.isSome(unseenWhileLive(opened, get))),
)

export const seenWhileOpenAtom = Atom.family((opened: OpenedAgent) =>
  hubRuntime.atom((get) =>
    get(unseenWhileLiveAtom(opened))
      ? Effect.gen(function* () {
          const link = yield* HubLink

          yield* link
            .markSeen(opened.machine, opened.pane)
            .pipe(Effect.catch((error) => Effect.logWarning(error.message)))
        })
      : Effect.void,
  ),
)
