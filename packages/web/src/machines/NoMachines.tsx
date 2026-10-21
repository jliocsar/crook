import { Server } from 'lucide-react'

import { Button } from '@crook/web/components/ui/button'
import { EmptyState } from '@crook/web/components/ui/empty-state'

export function NoMachines({ onAddMachine }: { onAddMachine: () => void }) {
  return (
    <div className="px-4 pt-6">
      <EmptyState
        icon={<Server className="size-5" />}
        title="No machines yet"
        description="Install the crook plugin on any machine running Herdr and it shows up here."
        actions={
          <Button size="touch" className="text-base" onClick={onAddMachine}>
            Add a machine
          </Button>
        }
      />
    </div>
  )
}
