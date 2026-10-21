import { useAtomValue } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as React from 'react'

import { connectionAtom } from '@crook/web/atoms/Connection'
import { machinesLayoutAtom } from '@crook/web/atoms/Machines'
import { Dimmed } from '@crook/web/components/Dimmed'
import { HerdSkeleton } from '@crook/web/herd/HerdSkeleton'
import { AddMachineButton, AddMachineSheet } from '@crook/web/machines/AddMachineSheet'
import { MachineList } from '@crook/web/machines/MachineList'
import type { OpenMachine } from '@crook/web/machines/MachineList'
import { NoMachines } from '@crook/web/machines/NoMachines'
import { openedFrom } from '@crook/web/navigation/Opener'
import { TabScreen } from '@crook/web/navigation/TabScreen'
import { useNow } from '@crook/web/time/Now'

export function MachinesScreen() {
  const connection = useAtomValue(connectionAtom)
  const layout = useAtomValue(machinesLayoutAtom)
  const navigate = useNavigate()
  const now = useNow()
  const [adding, setAdding] = React.useState(false)

  const openMachine: OpenMachine = (machine, opener) => {
    void navigate({ to: '/machines/$machine', params: { machine }, state: openedFrom(opener) })
  }

  const openSheet = () => {
    setAdding(true)
  }

  return (
    <TabScreen title="Machines" action={<AddMachineButton onOpen={openSheet} />}>
      {Option.match(layout, {
        onNone: () => (connection.ready ? <HerdSkeleton label="Loading your machines" /> : null),
        onSome: (machines) => (
          <Dimmed dimmed={connection.stale}>
            {Arr.isReadonlyArrayEmpty(machines.machines) ? (
              <NoMachines onAddMachine={openSheet} />
            ) : (
              <MachineList
                layout={machines}
                now={now}
                controlsEnabled={connection.controlsEnabled}
                onOpen={openMachine}
              />
            )}
          </Dimmed>
        ),
      })}
      <AddMachineSheet
        open={adding}
        onClose={() => {
          setAdding(false)
        }}
      />
    </TabScreen>
  )
}
