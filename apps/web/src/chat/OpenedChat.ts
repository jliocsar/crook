import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import type { MachineId, PaneId } from '@crook/domain/Ids'
import { chatScreenAtom } from '@crook/web/atoms/Chat'
import { canActAtom, dimsContentAtom } from '@crook/web/atoms/Connection'
import { OpenedAgent, recordOpenedAtom, seenWhileOpenAtom } from '@crook/web/atoms/Herd'
import {
  transcriptAtom,
  transcriptEarlierAtom,
  transcriptRetryAtom,
  transcriptStateOf,
} from '@crook/web/atoms/Transcript'
import type { TranscriptKey } from '@crook/web/atoms/Transcript'
import {
  activityEventOf,
  activityMachine,
  lastTurnEvidence,
  runEventOf,
  sameActivity,
} from '@crook/web/chat/ActivityMachine'
import type { ActivityEvent, ActivityState, TurnEvidence } from '@crook/web/chat/ActivityMachine'
import { deriveChat, EMPTY_CHAT } from '@crook/web/chat/ChatItems'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'
import { PresenceState } from '@crook/web/chat/PresenceMachine'
import type { ChatContext, ChatItem } from '@crook/web/chat/ChatItems'
import type { TranscriptLine } from '@crook/web/chat/TranscriptState'

const useTurnEvidence = (
  lines: readonly TranscriptLine[],
  watchFailed: boolean,
): Option.Option<TurnEvidence> =>
  React.useMemo(() => (watchFailed ? Option.none() : lastTurnEvidence(lines)), [lines, watchFailed])

const useActivityFold = (event: ActivityEvent): ActivityState => {
  const [held, setHeld] = React.useState<ActivityState>(activityMachine.initial)
  const [next] = activityMachine.transition(held, event)

  if (sameActivity(next, held)) {
    return held
  }

  setHeld(next)

  return next
}

export const useChatActivity = (
  model: ChatScreenModel,
  lines: readonly TranscriptLine[],
  watchFailed: boolean,
): ActivityState => {
  const evidence = useTurnEvidence(lines, watchFailed)

  return useActivityFold(activityEventOf(model.presence, model.row, evidence))
}

export const useRunActivity = (
  runningSince: Option.Option<DateTime.Utc>,
  lines: readonly TranscriptLine[],
  watchFailed: boolean,
): ActivityState => {
  const evidence = useTurnEvidence(lines, watchFailed)

  return useActivityFold(runEventOf(runningSince, evidence))
}

export const useOpenedChat = (machine: MachineId, pane: PaneId) => {
  const opened = React.useMemo(() => new OpenedAgent({ machine, pane }), [machine, pane])
  const model = useAtomValue(chatScreenAtom(opened))
  const canAct = useAtomValue(canActAtom)
  const connectionDims = useAtomValue(dimsContentAtom)

  const recordOpened = useAtomSet(recordOpenedAtom)

  useAtomMount(seenWhileOpenAtom(opened))

  React.useEffect(() => {
    recordOpened(opened)
  }, [opened, recordOpened])

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
