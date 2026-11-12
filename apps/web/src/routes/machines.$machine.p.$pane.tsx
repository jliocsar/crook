import { createFileRoute, Outlet } from '@tanstack/react-router'

import { PaneId } from '@crook/domain/Ids'
import { AgentChatScreen } from '@crook/web/chat/AgentChatScreen'

export const Route = createFileRoute('/machines/$machine/p/$pane')({
  staticData: { pushed: true },
  params: {
    parse: ({ pane }) => ({ pane: PaneId.make(pane) }),
    stringify: ({ pane }) => ({ pane }),
  },
  component: MachineAgentChat,
})

function MachineAgentChat() {
  const { machine, pane } = Route.useParams()

  return (
    <>
      <AgentChatScreen machine={machine} pane={pane} parent="machine" />
      <Outlet />
    </>
  )
}
