import { useNavigate } from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as React from 'react'

import { connectionAtom } from '@crook/web/atoms/Connection'
import { allowsActions, dimsContent } from '@crook/web/connection/ConnectionView'
import { machinesLayoutAtom } from '@crook/web/atoms/Machines'
import { Dimmed } from '@crook/web/components/Dimmed'
import { HerdSkeleton } from '@crook/web/herd/HerdSkeleton'
import { AddMachineButton, AddMachineSheet } from '@crook/web/machines/AddMachineSheet'
import { MachineList } from '@crook/web/machines/MachineList'
import type { OpenMachine } from '@crook/web/machines/MachineList'
import { NoMachines } from '@crook/web/machines/NoMachines'
import { useShownAtomValue } from '@crook/web/navigation/Covered'
import { openedFrom } from '@crook/web/navigation/Opener'
import { TabScreen } from '@crook/web/navigation/TabScreen'

function MachinesBody({ onOpen, onAddMachine }: { onOpen: OpenMachine; onAddMachine: () => void }) {
  const connection = useShownAtomValue(connectionAtom)
  const layout = useShownAtomValue(machinesLayoutAtom)

  return Option.match(layout, {
    onNone: () => <HerdSkeleton label="Loading your machines" />,
    onSome: (machines) => (
      <Dimmed dimmed={dimsContent(connection)}>
        {Arr.isReadonlyArrayEmpty(machines.machines) ? (
          <NoMachines onAddMachine={onAddMachine} />
        ) : (
          <MachineList
            layout={machines}
            controlsEnabled={allowsActions(connection)}
            onOpen={onOpen}
          />
        )}
      </Dimmed>
    ),
  })
}

export function MachinesScreen() {
  const navigate = useNavigate()
  const [adding, setAdding] = React.useState(false)

  const openMachine: OpenMachine = (machine, opener) => {
    void navigate({ to: '/machines/$machine', params: { machine }, state: openedFrom(opener) })
  }

  const openSheet = () => {
    setAdding(true)
  }

  return (
    <TabScreen title="Machines" action={<AddMachineButton onOpen={openSheet} />}>
      <MachinesBody onOpen={openMachine} onAddMachine={openSheet} />
      <AddMachineSheet
        open={adding}
        onClose={() => {
          setAdding(false)
        }}
      />
    </TabScreen>
  )
}
