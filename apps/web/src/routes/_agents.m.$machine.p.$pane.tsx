import { createFileRoute, Outlet } from '@tanstack/react-router'

import { MachineId, PaneId } from '@crook/domain/Ids'
import { AgentChatScreen } from '@crook/web/chat/AgentChatScreen'

export const Route = createFileRoute('/_agents/m/$machine/p/$pane')({
  staticData: { pushed: true },
  params: {
    parse: ({ machine, pane }) => ({ machine: MachineId.make(machine), pane: PaneId.make(pane) }),
    stringify: ({ machine, pane }) => ({ machine, pane }),
  },
  component: AgentChat,
})

function AgentChat() {
  const { machine, pane } = Route.useParams()

  return (
    <>
      <AgentChatScreen machine={machine} pane={pane} parent="agents" />
      <Outlet />
    </>
  )
}
