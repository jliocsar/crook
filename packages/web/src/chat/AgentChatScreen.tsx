import { useAtomMount, useAtomValue } from '@effect/atom-react/Hooks'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

import type { MachineId, PaneId } from '@crook/domain/Ids'
import { herdAtom, OpenedAgent, seenWhileOpenAtom } from '@crook/web/atoms/Herd'
import { StatusWord } from '@crook/web/components/StatusWord'
import { findAgent } from '@crook/web/herd/HerdLayout'
import { PushedHeader, PushedScreen } from '@crook/web/navigation/PushedScreen'

export function AgentChatScreen({ machine, pane }: { machine: MachineId; pane: PaneId }) {
  const herd = useAtomValue(herdAtom)
  const agent = pipe(
    herd,
    Option.flatMap((snapshot) => findAgent(snapshot.view, machine, pane)),
  )

  useAtomMount(seenWhileOpenAtom(new OpenedAgent({ machine, pane })))

  return (
    <PushedScreen>
      {Option.match(agent, {
        onNone: () => <PushedHeader title={pane} backLabel="Back to Agents" />,
        onSome: ({ herdMachine, row }) => (
          <PushedHeader
            title={row.title === '' ? row.pane : row.title}
            subtitle={
              <>
                <StatusWord status={row.status} className="font-semibold" />
                <span aria-hidden="true">·</span>
                <span className="truncate">{herdMachine.machine.label}</span>
              </>
            }
            backLabel="Back to Agents"
          />
        ),
      })}
    </PushedScreen>
  )
}
