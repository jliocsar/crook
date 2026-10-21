import { createFileRoute } from '@tanstack/react-router'

import { MachineId } from '@crook/domain/Ids'
import { MachineScreen } from '@crook/web/machines/MachineScreen'

export const Route = createFileRoute('/machines/$machine')({
  staticData: { pushed: true },
  params: {
    parse: ({ machine }) => ({ machine: MachineId.make(machine) }),
    stringify: ({ machine }) => ({ machine }),
  },
  component: MachineRoute,
})

function MachineRoute() {
  const { machine } = Route.useParams()

  return <MachineScreen machine={machine} />
}
