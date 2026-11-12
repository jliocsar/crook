import { useAtom } from '@effect/atom-react/Hooks'
import * as React from 'react'

import type { MachineId, PaneId } from '@crook/domain/Ids'
import { draftAtom } from '@crook/web/atoms/Drafts'
import { ComposerDraft, DraftKey } from '@crook/web/cache/DraftCache'
import type { DraftAttachment } from '@crook/web/chat/Attachments'

export const usePaneDraft = (machine: MachineId, pane: PaneId) => {
  const [paneDraft, setPaneDraft] = useAtom(draftAtom(new DraftKey({ machine, pane })))
  const setDraft = React.useCallback(
    (text: string) => {
      setPaneDraft((current) => new ComposerDraft({ text, attachments: current.attachments }))
    },
    [setPaneDraft],
  )
  const setAttachments = React.useCallback(
    (attachments: readonly DraftAttachment[]) => {
      setPaneDraft((current) => new ComposerDraft({ text: current.text, attachments }))
    },
    [setPaneDraft],
  )

  return {
    draft: paneDraft.text,
    attachments: paneDraft.attachments,
    setDraft,
    setAttachments,
  }
}
