import { useNavigate } from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as React from 'react'

import { connectionAtom } from '@crook/web/atoms/Connection'
import { allowsActions, dimsContent } from '@crook/web/connection/ConnectionView'
import type { ConnectionView } from '@crook/web/connection/ConnectionView'
import { machinesLayoutAtom } from '@crook/web/atoms/Machines'
import { Dimmed } from '@crook/web/components/Dimmed'
import { AddMachineButton, AddMachineSheet } from '@crook/web/machines/AddMachineSheet'
import { MachineList } from '@crook/web/machines/MachineList'
import type { MachinesLayout } from '@crook/web/machines/MachineLayout'
import { MachinesSkeleton } from '@crook/web/machines/MachinesSkeleton'
import type { OpenMachine } from '@crook/web/machines/MachineList'
import { NoMachines } from '@crook/web/machines/NoMachines'
import { StillUnderCover, useShownAtomValue } from '@crook/web/navigation/Covered'
import { openedFrom } from '@crook/web/navigation/Opener'
import { TabScreen } from '@crook/web/navigation/TabScreen'

interface MachinesBodyProps {
  readonly onOpen: OpenMachine
  readonly onAddMachine: () => void
}

const MachinesContent = React.memo(function MachinesContent({
  connection,
  layout,
  onOpen,
  onAddMachine,
}: MachinesBodyProps & {
  readonly connection: ConnectionView
  readonly layout: Option.Option<MachinesLayout>
}) {
  return (
    <StillUnderCover>
      {Option.match(layout, {
        onNone: () => <MachinesSkeleton />,
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
      })}
    </StillUnderCover>
  )
})

function MachinesBody(props: MachinesBodyProps) {
  const connection = useShownAtomValue(connectionAtom)
  const layout = useShownAtomValue(machinesLayoutAtom)

  return <MachinesContent connection={connection} layout={layout} {...props} />
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
