import { createFileRoute } from '@tanstack/react-router'

import { ClaudeSessionId, SubagentId } from '@crook/domain/Ids'
import { SubagentScreen } from '@crook/web/chat/SubagentScreen'

export const Route = createFileRoute('/machines/$machine/p/$pane/sub/$session/$subagent')({
  staticData: { pushed: true },
  params: {
    parse: ({ session, subagent }) => ({
      session: ClaudeSessionId.make(session),
      subagent: SubagentId.make(subagent),
    }),
    stringify: ({ session, subagent }) => ({ session, subagent }),
  },
  component: MachineSubagentRoute,
})

function MachineSubagentRoute() {
  const { machine, pane, session, subagent } = Route.useParams()

  return <SubagentScreen machine={machine} pane={pane} session={session} subagent={subagent} />
}
