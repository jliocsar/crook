import type * as DateTime from 'effect/DateTime'
import { Bot, ServerOff } from 'lucide-react'

import { Button } from '@crook/web/components/ui/button'
import { EmptyState } from '@crook/web/components/ui/empty-state'
import { shortElapsed } from '@crook/web/time/Elapsed'
import { useNow } from '@crook/web/time/Now'

export function NothingRunning({
  controlsEnabled,
  onNewAgent,
}: {
  controlsEnabled: boolean
  onNewAgent: (opener: HTMLElement) => void
}) {
  return (
    <div className="px-4">
      <EmptyState
        icon={<Bot className="size-5" />}
        title="Nothing running"
        description="No agents on any of your machines. Start Claude on one of them."
        actions={
          <Button
            size="touch"
            className="text-base"
            disabled={!controlsEnabled}
            onClick={(event) => {
              onNewAgent(event.currentTarget)
            }}
          >
            New agent
          </Button>
        }
      />
    </div>
  )
}

export function AllOffline() {
  return (
    <p className="text-muted-foreground flex items-center gap-2 px-4 text-sm leading-5">
      <ServerOff aria-hidden="true" className="size-4 shrink-0" />
      All machines are offline
    </p>
  )
}

export function NoAgentsLine() {
  return <p className="text-muted-foreground px-4 pt-1 pb-1 text-sm">No agents</p>
}

export function OfflineLine({ lastSeenAt }: { lastSeenAt: DateTime.Utc }) {
  const now = useNow()

  return (
    <p className="text-muted-foreground px-4 pt-1 pb-2 text-sm">
      Last seen {shortElapsed(now, lastSeenAt)} ago. Its agents come back when it reconnects.
    </p>
  )
}
