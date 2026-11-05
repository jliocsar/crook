import { useAtomSet } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import * as Option from 'effect/Option'
import { Plus } from 'lucide-react'
import * as React from 'react'

import type { MachineId } from '@crook/domain/Ids'
import { useOpenAgentActions } from '@crook/web/actions/AgentActions'
import type { OpenAgentActions } from '@crook/web/actions/AgentActions'
import { connectionAtom } from '@crook/web/atoms/Connection'
import { allowsActions, dimsContent } from '@crook/web/connection/ConnectionView'
import { herdLayoutAtom, resyncAtom } from '@crook/web/atoms/Herd'
import { Dimmed } from '@crook/web/components/Dimmed'
import { Button } from '@crook/web/components/ui/button'
import { HerdList } from '@crook/web/herd/HerdList'
import type { OpenAgent } from '@crook/web/herd/HerdList'
import { HerdSkeleton } from '@crook/web/herd/HerdSkeleton'
import { PullToResync } from '@crook/web/herd/PullToResync'
import { AddMachineSheet } from '@crook/web/machines/AddMachineSheet'
import { useShownAtomValue } from '@crook/web/navigation/Covered'
import { openedFrom } from '@crook/web/navigation/Opener'
import { TabScreen } from '@crook/web/navigation/TabScreen'

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

function NewAgentButton({ onOpen }: { onOpen: (opener: HTMLElement) => void }) {
  const connection = useShownAtomValue(connectionAtom)

  return (
    <Button
      variant="ghost"
      size="icon-touch"
      aria-label="New agent"
      disabled={!allowsActions(connection)}
      onClick={(event) => {
        onOpen(event.currentTarget)
      }}
    >
      <Plus className="size-6" />
    </Button>
  )
}

function HerdBody({
  isOpen,
  onToggle,
  onOpenAgent,
  onOpenActions,
  onNewAgent,
  onAddMachine,
}: {
  isOpen: (machine: MachineId) => boolean
  onToggle: (machine: MachineId) => void
  onOpenAgent: OpenAgent
  onOpenActions: OpenAgentActions
  onNewAgent: (opener: HTMLElement) => void
  onAddMachine: () => void
}) {
  const connection = useShownAtomValue(connectionAtom)
  const layout = useShownAtomValue(herdLayoutAtom)
  const resync = useAtomSet(resyncAtom, { mode: 'promise' })

  return Option.match(layout, {
    onNone: () => <HerdSkeleton label="Loading your agents" />,
    onSome: (herdLayout) => (
      <PullToResync enabled={allowsActions(connection)} onResync={() => resync(undefined)}>
        <Dimmed dimmed={dimsContent(connection)}>
          <HerdList
            layout={herdLayout}
            controlsEnabled={allowsActions(connection)}
            isOpen={isOpen}
            onToggle={onToggle}
            onOpenAgent={onOpenAgent}
            onOpenActions={onOpenActions}
            onNewAgent={onNewAgent}
            onAddMachine={onAddMachine}
          />
        </Dimmed>
      </PullToResync>
    ),
  })
}

export function HerdScreen() {
  const navigate = useNavigate()
  const sections = useCollapsedMachines()
  const [addingMachine, setAddingMachine] = React.useState(false)
  const openActions = useOpenAgentActions()

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
    <TabScreen title="crook" action={<NewAgentButton onOpen={openNewAgent} />}>
      <HerdBody
        isOpen={sections.isOpen}
        onToggle={sections.toggle}
        onOpenAgent={openAgent}
        onOpenActions={openActions}
        onNewAgent={openNewAgent}
        onAddMachine={() => {
          setAddingMachine(true)
        }}
      />
      <AddMachineSheet
        open={addingMachine}
        onClose={() => {
          setAddingMachine(false)
        }}
      />
    </TabScreen>
  )
}
