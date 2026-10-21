import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import type * as React from 'react'

import type { ChatItem } from '@crook/web/chat/ChatItems'
import { RowAction } from '@crook/web/chat/RowAction'
import type { ThreadRow } from '@crook/web/chat/Thread'
import { ThreadItem } from '@crook/web/chat/ThreadItem'
import type { ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import type { TranscriptView } from '@crook/web/chat/TranscriptState'
import { Spinner } from '@crook/web/components/ui/spinner'
import { ThinkingState } from '@crook/web/components/ui/thinking-state'

const WORKING_KEY = 'working'
const FAILURE_KEY = 'transcript failure'
const WORKING_LABEL = 'Working'

export const NO_MESSAGES = 'No messages yet'

export const itemRows = (
  items: readonly ChatItem[],
  environment: ThreadEnvironment,
): readonly ThreadRow[] =>
  Arr.map(items, (item) => ({
    key: item.key,
    content: <ThreadItem item={item} environment={environment} />,
  }))

export const workingRow = (elapsed: string): ThreadRow => ({
  key: WORKING_KEY,
  content: <ThinkingState label={WORKING_LABEL} elapsed={elapsed} />,
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
        <RowAction label="Try again" onAction={onRetry}>
          <p role="alert" className="text-destructive px-1 text-center text-sm leading-5">
            {failure.message}
          </p>
        </RowAction>
      ),
    })),
    Option.toArray,
  )

export function LoadingThread() {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
      <Spinner />
      <span>Loading the conversation</span>
    </div>
  )
}

export function QuietThread({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground py-10 text-center text-sm">{children}</p>
}
