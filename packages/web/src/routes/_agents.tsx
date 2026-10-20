import { createFileRoute } from '@tanstack/react-router'

import { TabScreen } from '@/navigation/TabScreen'

export const Route = createFileRoute('/_agents')({ component: Agents })

function Agents() {
  return <TabScreen title="crook" />
}
