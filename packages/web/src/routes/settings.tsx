import { createFileRoute } from '@tanstack/react-router'

import { TabScreen } from '@crook/web/navigation/TabScreen'

export const Route = createFileRoute('/settings')({ component: Settings })

function Settings() {
  return <TabScreen title="Settings" />
}
