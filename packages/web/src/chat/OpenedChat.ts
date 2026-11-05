import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import type { MachineId, PaneId } from '@crook/domain/Ids'
import { chatScreenAtom } from '@crook/web/atoms/Chat'
import { canActAtom, dimsContentAtom } from '@crook/web/atoms/Connection'
import { OpenedAgent, seenWhileOpenAtom } from '@crook/web/atoms/Herd'
import {
  transcriptAtom,
  transcriptEarlierAtom,
  transcriptRetryAtom,
  transcriptStateOf,
} from '@crook/web/atoms/Transcript'
import type { TranscriptKey } from '@crook/web/atoms/Transcript'
import { deriveChat, EMPTY_CHAT } from '@crook/web/chat/ChatItems'
import { PresenceState } from '@crook/web/chat/PresenceMachine'
import type { ChatContext, ChatItem } from '@crook/web/chat/ChatItems'
import type { TranscriptLine } from '@crook/web/chat/TranscriptState'

export const useOpenedChat = (machine: MachineId, pane: PaneId) => {
  const opened = React.useMemo(() => new OpenedAgent({ machine, pane }), [machine, pane])
  const model = useAtomValue(chatScreenAtom(opened))
  const canAct = useAtomValue(canActAtom)
  const connectionDims = useAtomValue(dimsContentAtom)

  useAtomMount(seenWhileOpenAtom(opened))

  return {
    opened,
    model,
    canAct,
    dimmed: PresenceState.guards.Away(model.presence) || connectionDims,
  }
}

export const useTranscriptThread = (key: TranscriptKey) => {
  const result = useAtomValue(transcriptAtom(key))
  const askEarlier = useAtomSet(transcriptEarlierAtom(key))
  const retry = useAtomSet(transcriptRetryAtom(key))
  const onShowEarlier = React.useCallback(() => {
    askEarlier((count) => count + 1)
  }, [askEarlier])
  const onRetry = React.useCallback(() => {
    retry((count) => count + 1)
  }, [retry])

  return {
    state: transcriptStateOf(result),
    started: Option.isSome(AsyncResult.value(result)),
    onShowEarlier,
    onRetry,
  }
}

export const useChatItems = (
  lines: readonly TranscriptLine[],
  { cwd, activity, rosters }: ChatContext,
): readonly ChatItem[] => {
  const derived = React.useRef(EMPTY_CHAT)

  return React.useMemo(() => {
    derived.current = deriveChat(derived.current, lines, { cwd, activity, rosters })

    return derived.current.items
  }, [lines, cwd, activity, rosters])
}
