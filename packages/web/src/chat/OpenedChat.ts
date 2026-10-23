import { useAtomMount, useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import * as React from 'react'

import type { MachineId, PaneId } from '@crook/domain/Ids'
import { chatScreenAtom } from '@crook/web/atoms/Chat'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { OpenedAgent, seenWhileOpenAtom } from '@crook/web/atoms/Herd'
import {
  transcriptAtom,
  transcriptRetryAtom,
  transcriptWholeAtom,
} from '@crook/web/atoms/Transcript'
import type { TranscriptKey } from '@crook/web/atoms/Transcript'

export const useOpenedChat = (machine: MachineId, pane: PaneId) => {
  const opened = React.useMemo(() => new OpenedAgent({ machine, pane }), [machine, pane])
  const model = useAtomValue(chatScreenAtom(opened))
  const connection = useAtomValue(connectionAtom)

  useAtomMount(seenWhileOpenAtom(opened))

  return { opened, model, connection, dimmed: model.presence === 'away' || connection.stale }
}

export const useTranscriptThread = (key: TranscriptKey) => {
  const result = useAtomValue(transcriptAtom(key))
  const showWhole = useAtomSet(transcriptWholeAtom(key))
  const retry = useAtomSet(transcriptRetryAtom(key))
  const onShowEarlier = React.useCallback(() => {
    showWhole(true)
  }, [showWhole])
  const onRetry = React.useCallback(() => {
    retry((count) => count + 1)
  }, [retry])

  return { result, onShowEarlier, onRetry }
}
