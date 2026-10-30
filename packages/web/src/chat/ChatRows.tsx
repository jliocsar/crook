import * as Arr from 'effect/Array'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as React from 'react'

import type { ChatItem } from '@crook/web/chat/ChatItems'
import { RowAction } from '@crook/web/chat/RowAction'
import type { ThreadRow } from '@crook/web/chat/Thread'
import { ThreadItem } from '@crook/web/chat/ThreadItem'
import type { ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import { isCatchingUp } from '@crook/web/chat/TranscriptState'
import type { TranscriptView } from '@crook/web/chat/TranscriptState'
import { ActionFailure } from '@crook/web/components/ActionFailure'
import { Skeleton } from '@crook/web/components/ui/skeleton'
import { ThinkingState } from '@crook/web/components/ui/thinking-state'
import { useNow } from '@crook/web/time/Now'

const WORKING_KEY = 'working'
const FAILURE_KEY = 'transcript failure'
const WORKING_LABEL = 'Working'
const NO_MESSAGES = 'No messages yet'

const itemRow = (
  rows: WeakMap<ChatItem, ThreadRow>,
  item: ChatItem,
  environment: ThreadEnvironment,
): ThreadRow => {
  const known = rows.get(item)

  if (known !== undefined) {
    return known
  }

  const row = { key: item.key, content: <ThreadItem item={item} environment={environment} /> }

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
  view: Option.Option<TranscriptView>,
  onRetry: () => void,
): readonly ThreadRow[] =>
  pipe(
    Option.flatMap(view, (found) => found.failure),
    Option.map((failure) => ({
      key: FAILURE_KEY,
      content: (
        <RowAction
          label="Try again"
          pendingLabel="Trying again"
          pending={isCatchingUp(view)}
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

function LoadingThread() {
  return (
    <div role="status" data-slot="thread-skeleton" className="grid grid-cols-1 gap-6 px-1 py-1">
      <span className="sr-only">Loading the conversation</span>
      <Skeleton className="ms-auto h-11 w-3/5 rounded-2xl rounded-tr-sm" />
      <Skeleton lines={3} />
      <Skeleton className="ms-auto h-11 w-2/5 rounded-2xl rounded-tr-sm" />
      <Skeleton lines={4} />
    </div>
  )
}

export function TranscriptEmpty({ view }: { view: Option.Option<TranscriptView> }) {
  return Option.isNone(view) ? (
    <LoadingThread />
  ) : (
    <p className="text-muted-foreground py-10 text-center text-sm">{NO_MESSAGES}</p>
  )
}
