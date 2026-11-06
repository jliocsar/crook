import * as Match from 'effect/Match'

import { isWatching, machineLabelOf } from '@crook/web/chat/ChatModel'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'
import { PresenceState } from '@crook/web/chat/PresenceMachine'
import { useSkeletonHold } from '@crook/web/chat/SkeletonHold'
import type { ThreadRow } from '@crook/web/chat/Thread'
import { ThreadSkeleton } from '@crook/web/chat/ThreadSkeleton'
import { knowsNothing, TranscriptViewState } from '@crook/web/chat/TranscriptMachine'
import { EmptyState } from '@crook/web/components/ui/empty-state'

type EmptyThread = 'not-claude' | 'skeleton' | 'machine-away' | 'nothing-cached' | 'no-messages'

const NO_MESSAGES = 'No messages yet'
const NOT_CLAUDE = 'Not a Claude pane'
const NOTHING_CACHED = 'No messages on this phone yet'
const NO_ROWS: readonly ThreadRow[] = []

const emptyThreadOf = (
  model: ChatScreenModel,
  state: TranscriptViewState,
  started: boolean,
): EmptyThread => {
  if (PresenceState.guards.NotClaude(model.presence)) {
    return 'not-claude'
  }

  if (!started) {
    return 'skeleton'
  }

  if (PresenceState.guards.Away(model.presence)) {
    return 'machine-away'
  }

  if (!isWatching(model) && knowsNothing(state)) {
    return 'nothing-cached'
  }

  return TranscriptViewState.guards.NoView(state) ? 'skeleton' : 'no-messages'
}

export const useThreadContent = (
  rows: readonly ThreadRow[],
  model: ChatScreenModel,
  state: TranscriptViewState,
  started: boolean,
) => {
  const shown = emptyThreadOf(model, state, started)
  const holding = useSkeletonHold(rows.length === 0 && shown === 'skeleton')

  return {
    rows: holding ? NO_ROWS : rows,
    empty: <ThreadEmpty shown={holding ? 'skeleton' : shown} model={model} />,
  }
}

function ThreadEmpty({ shown, model }: { shown: EmptyThread; model: ChatScreenModel }) {
  return Match.value(shown).pipe(
    Match.when('not-claude', () => <EmptyState title={NOT_CLAUDE} />),
    Match.when('skeleton', () => <ThreadSkeleton />),
    Match.when('machine-away', () => (
      <EmptyState
        title={NOTHING_CACHED}
        description={`They show once ${machineLabelOf(model)} is back.`}
      />
    )),
    Match.when('nothing-cached', () => <EmptyState title={NOTHING_CACHED} />),
    Match.when('no-messages', () => (
      <p data-slot="empty-state" className="text-muted-foreground py-10 text-center text-sm">
        {NO_MESSAGES}
      </p>
    )),
    Match.exhaustive,
  )
}
