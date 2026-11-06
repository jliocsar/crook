import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as React from 'react'

import { isOmitted } from '@crook/web/chat/ChatItems'
import type { ChatItem } from '@crook/web/chat/ChatItems'
import { RowAction } from '@crook/web/chat/RowAction'
import type { ThreadRow } from '@crook/web/chat/Thread'
import { ThreadItem } from '@crook/web/chat/ThreadItem'
import type { ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import { failureOf, isRetrying } from '@crook/web/chat/TranscriptMachine'
import type { TranscriptViewState } from '@crook/web/chat/TranscriptMachine'
import { ActionFailure } from '@crook/web/components/ActionFailure'
import { ThinkingState } from '@crook/web/components/ui/thinking-state'
import { useNow } from '@crook/web/time/Now'

const WORKING_KEY = 'working'
const FAILURE_KEY = 'transcript failure'
const WORKING_LABEL = 'Working'

const itemRow = (
  rows: WeakMap<ChatItem, ThreadRow>,
  item: ChatItem,
  environment: ThreadEnvironment,
): ThreadRow => {
  const known = rows.get(item)

  if (known !== undefined) {
    return known
  }

  const row = {
    key: item.key,
    content: <ThreadItem item={item} environment={environment} />,
    hole: isOmitted(item),
  }

  rows.set(item, row)

  return row
}

export const useItemRows = (
  items: readonly ChatItem[],
  environment: ThreadEnvironment,
): readonly ThreadRow[] => {
  const rows = React.useMemo(() => new WeakMap<ChatItem, ThreadRow>(), [environment])

  return React.useMemo(
    () => Arr.map(items, (item) => itemRow(rows, item, environment)),
    [items, rows, environment],
  )
}

export const workingRow = (elapsed: (now: DateTime.Utc) => string): ThreadRow => ({
  key: WORKING_KEY,
  content: <WorkingThought elapsed={elapsed} />,
  placeholder: true,
})

export const failureRows = (
  state: TranscriptViewState,
  onRetry: () => void,
): readonly ThreadRow[] =>
  pipe(
    failureOf(state),
    Option.map((failure) => ({
      key: FAILURE_KEY,
      content: (
        <RowAction
          label="Try again"
          pendingLabel="Trying again"
          pending={isRetrying(state)}
          onAction={onRetry}
        >
          <ActionFailure className="px-1 text-center" message={Option.some(failure.message)} />
        </RowAction>
      ),
    })),
    Option.toArray,
  )

function WorkingThought({ elapsed }: { elapsed: (now: DateTime.Utc) => string }) {
  const now = useNow()

  return <ThinkingState label={WORKING_LABEL} elapsed={elapsed(now)} />
}
