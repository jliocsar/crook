import * as Equal from 'effect/Equal'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'

import { isVerifiedAtom } from '@crook/web/atoms/Connection'
import { hubRuntime } from '@crook/web/atoms/Hub'
import type { OpenedAgent } from '@crook/web/atoms/Herd'
import { herdAtom } from '@crook/web/atoms/Herd'
import type { AlwaysNote } from '@crook/web/chat/AskModel'
import { chatScreenModel, LOADING_CHAT, withPresence } from '@crook/web/chat/ChatModel'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'
import {
  LOADING,
  presenceEventOf,
  presenceMachine,
  presenceTimer,
} from '@crook/web/chat/PresenceMachine'
import { machineAtom } from '@crook/web/machine/MachineAtom'

export const alwaysNotesAtom = Atom.family((opened: OpenedAgent) =>
  Atom.make<readonly AlwaysNote[]>([]).pipe(
    Atom.keepAlive,
    Atom.withLabel(`always notes ${opened.machine} ${opened.pane}`),
  ),
)

const lastSeenRowAtom = Atom.family((opened: OpenedAgent) =>
  Atom.make((get) =>
    chatScreenModel(
      get(herdAtom),
      opened.machine,
      opened.pane,
      Option.getOrElse(get.self<ChatScreenModel>(), () => LOADING_CHAT),
      LOADING,
    ),
  ).pipe(Atom.withEquality(Equal.equals)),
)

const observedPresenceAtom = Atom.family((opened: OpenedAgent) =>
  Atom.make((get) =>
    presenceEventOf(
      get(herdAtom),
      opened.machine,
      opened.pane,
      Option.isSome(get(lastSeenRowAtom(opened)).row),
      get(isVerifiedAtom),
    ),
  ).pipe(Atom.withEquality(Equal.equals)),
)

export const presenceAtom = Atom.family((opened: OpenedAgent) =>
  machineAtom({
    machine: presenceMachine,
    observed: observedPresenceAtom(opened),
    runtime: hubRuntime,
    perform: presenceTimer,
  }),
)

export const chatScreenAtom = Atom.family((opened: OpenedAgent) =>
  Atom.make((get) => withPresence(get(lastSeenRowAtom(opened)), get(presenceAtom(opened)))).pipe(
    Atom.withEquality(Equal.equals),
  ),
)
