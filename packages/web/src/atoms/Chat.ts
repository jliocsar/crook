import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'

import type { OpenedAgent } from '@crook/web/atoms/Herd'
import { herdAtom } from '@crook/web/atoms/Herd'
import { chatScreenModel, LOADING_CHAT } from '@crook/web/chat/ChatModel'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'

export const chatScreenAtom = Atom.family((opened: OpenedAgent) =>
  Atom.make((get) =>
    chatScreenModel(
      get(herdAtom),
      opened.machine,
      opened.pane,
      Option.getOrElse(get.self<ChatScreenModel>(), () => LOADING_CHAT),
    ),
  ),
)
