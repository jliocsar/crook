import { useAtom } from '@effect/atom-react/Hooks'
import * as Option from 'effect/Option'
import * as React from 'react'

import type { MachineId, PaneId } from '@crook/domain/Ids'
import { draftAtom } from '@crook/web/atoms/Drafts'
import { ComposerDraft, DraftKey, EMPTY_DRAFT } from '@crook/web/cache/DraftCache'
import type { DraftAttachment } from '@crook/web/chat/Attachments'

export const usePaneDraft = (machine: MachineId, pane: PaneId) => {
  const [paneDraft, setPaneDraft] = useAtom(draftAtom(new DraftKey({ machine, pane })))
  const shown = Option.getOrElse(paneDraft, () => EMPTY_DRAFT)
  const setDraft = React.useCallback(
    (text: string) => {
      setPaneDraft((current) =>
        Option.match(current, {
          onNone: () => EMPTY_DRAFT,
          onSome: (loaded) => new ComposerDraft({ text, attachments: loaded.attachments }),
        }),
      )
    },
    [setPaneDraft],
  )
  const setAttachments = React.useCallback(
    (attachments: readonly DraftAttachment[]) => {
      setPaneDraft((current) =>
        Option.match(current, {
          onNone: () => EMPTY_DRAFT,
          onSome: (loaded) => new ComposerDraft({ text: loaded.text, attachments }),
        }),
      )
    },
    [setPaneDraft],
  )

  return {
    draft: shown.text,
    attachments: shown.attachments,
    setDraft,
    setAttachments,
  }
}
