import { createFileRoute } from '@tanstack/react-router'

import { NewAgentScreen } from '@crook/web/newagent/NewAgentScreen'

export const Route = createFileRoute('/_agents/new')({
  staticData: { pushed: true },
  component: NewAgentScreen,
})
