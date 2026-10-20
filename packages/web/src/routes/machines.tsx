import { createFileRoute } from '@tanstack/react-router'

import { TabScreen } from '@/navigation/TabScreen'

export const Route = createFileRoute('/machines')({ component: Machines })

function Machines() {
  return <TabScreen title="Machines" />
}
