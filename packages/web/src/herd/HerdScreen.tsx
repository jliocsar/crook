import { useAtomSet, useAtomValue } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import * as Option from 'effect/Option'
import { Plus } from 'lucide-react'
import * as React from 'react'

import type { MachineId } from '@crook/domain/Ids'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { herdLayoutAtom, resyncAtom } from '@crook/web/atoms/Herd'
import { Dimmed } from '@crook/web/components/Dimmed'
import { Button } from '@crook/web/components/ui/button'
import { HerdList } from '@crook/web/herd/HerdList'
import type { OpenAgent } from '@crook/web/herd/HerdList'
import { HerdSkeleton } from '@crook/web/herd/HerdSkeleton'
import { PullToResync } from '@crook/web/herd/PullToResync'
import { openedFrom } from '@crook/web/navigation/Opener'
import { TabScreen } from '@crook/web/navigation/TabScreen'
import { useNow } from '@crook/web/time/Now'

const useCollapsedMachines = () => {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<MachineId>>(new Set())

  return {
    isOpen: (machine: MachineId) => !collapsed.has(machine),
    toggle: (machine: MachineId) => {
      setCollapsed((previous) => {
        const next = new Set(previous)

        if (!next.delete(machine)) {
          next.add(machine)
        }

        return next
      })
    },
  }
}

function NewAgentButton({
  disabled,
  onOpen,
}: {
  disabled: boolean
  onOpen: (opener: HTMLElement) => void
}) {
  return (
    <Button
      variant="ghost"
      size="icon-touch"
      aria-label="New agent"
      disabled={disabled}
      onClick={(event) => {
        onOpen(event.currentTarget)
      }}
    >
      <Plus className="size-6" />
    </Button>
  )
}

export function HerdScreen() {
  const connection = useAtomValue(connectionAtom)
  const layout = useAtomValue(herdLayoutAtom)
  const resync = useAtomSet(resyncAtom, { mode: 'promise' })
  const navigate = useNavigate()
  const now = useNow()
  const sections = useCollapsedMachines()

  const openNewAgent = (opener: HTMLElement) => {
    void navigate({ to: '/new', state: openedFrom(opener) })
  }

  const openAgent: OpenAgent = (machine, card, opener) => {
    void navigate({
      to: '/m/$machine/p/$pane',
      params: { machine, pane: card.row.pane },
      state: openedFrom(opener),
    })
  }

  return (
    <TabScreen
      title="crook"
      action={<NewAgentButton disabled={!connection.controlsEnabled} onOpen={openNewAgent} />}
    >
      {Option.match(layout, {
        onNone: () => (connection.ready ? <HerdSkeleton label="Loading your agents" /> : null),
        onSome: (herdLayout) => (
          <PullToResync enabled={connection.controlsEnabled} onResync={() => resync(undefined)}>
            <Dimmed dimmed={connection.stale}>
              <HerdList
                layout={herdLayout}
                now={now}
                controlsEnabled={connection.controlsEnabled}
                isOpen={sections.isOpen}
                onToggle={sections.toggle}
                onOpenAgent={openAgent}
                onNewAgent={openNewAgent}
              />
            </Dimmed>
          </PullToResync>
        ),
      })}
    </TabScreen>
  )
}
