import * as Option from 'effect/Option'
import { Bot, Folder, Server } from 'lucide-react'

import { EmptyState } from '@crook/web/components/ui/empty-state'
import { Spinner } from '@crook/web/components/ui/spinner'
import { NewAgentBody, StartsOn } from '@crook/web/newagent/NewAgentLayout'

const SUMMARY_CLASS = 'border-0 py-6'
const LOADING_SPINNER_SIZE = 14

function StartsOnText({ on }: { on: Option.Option<StartsOn> }) {
  return Option.match(on, {
    onNone: () => null,
    onSome: (branch) =>
      StartsOn.$match(branch, {
        NewWorktree: ({ branch: name }) => (
          <>
            , in a new worktree on <span className="font-mono text-xs">{name}</span>
          </>
        ),
        Branch: ({ branch: name }) => (
          <>
            , on <span className="font-mono text-xs">{name}</span>
          </>
        ),
      }),
  })
}

export function LaunchSummary({ body }: { body: NewAgentBody }) {
  return NewAgentBody.$match(body, {
    Loading: () => (
      <div className="text-muted-foreground flex justify-center">
        <Spinner size={LOADING_SPINNER_SIZE} label="Loading your machines" />
      </div>
    ),
    NoMachines: () => (
      <EmptyState
        className={SUMMARY_CLASS}
        icon={<Server className="size-5" />}
        title="No machines yet"
        description="Add one from Machines, then start Claude on it."
      />
    ),
    AllOffline: () => (
      <EmptyState
        className={SUMMARY_CLASS}
        icon={<Server className="size-5" />}
        title="Every machine is offline"
        description="Claude can start once one reconnects."
      />
    ),
    MachineOffline: ({ machine }) => (
      <EmptyState
        className={SUMMARY_CLASS}
        icon={<Server className="size-5" />}
        title={`${machine} is offline`}
        description="Pick another machine, or start Claude once it reconnects."
      />
    ),
    PickFolder: ({ machine }) => (
      <EmptyState
        className={SUMMARY_CLASS}
        icon={<Folder className="size-5" />}
        title={`Pick a folder on ${machine}`}
        description="Claude has not worked anywhere on it yet."
      />
    ),
    Starts: ({ folder, folderName, machine, on }) => (
      <EmptyState
        className={SUMMARY_CLASS}
        icon={<Bot className="size-5" />}
        title={`Claude starts in ${folderName}`}
        description={
          <>
            <span className="font-mono text-xs break-all">{folder}</span> on {machine}
            <StartsOnText on={on} />
          </>
        }
      />
    ),
  })
}
