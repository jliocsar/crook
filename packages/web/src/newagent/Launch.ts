import { useAtom } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import type { LaunchCommand } from '@crook/domain/Command'
import type { HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { failureMessage, settledError } from '@crook/web/atoms/ActionFailure'
import { LaunchAttempt, launchAtom } from '@crook/web/atoms/Launch'
import type { LaunchFailure } from '@crook/web/atoms/Launch'
import { retryKey } from '@crook/web/newagent/LaunchKey'
import { startedAgent } from '@crook/web/newagent/NewAgentLayout'
import type { StartedAgent } from '@crook/web/newagent/NewAgentLayout'
import { mintIdempotencyKey } from '@crook/web/rpc/IdempotencyKeys'

export interface Launch {
  readonly pending: boolean
  readonly opening: Option.Option<() => void>
  readonly failure: Option.Option<string>
  readonly openChatAfterFailure: Option.Option<() => void>
  readonly blocksRestart: boolean
  readonly start: (machine: MachineId, command: LaunchCommand) => void
}

const paneLeftRunning = (failure: LaunchFailure): Option.Option<PaneId> =>
  Match.value(failure).pipe(
    Match.tag('TaskNotDelivered', (refusal) => Option.some(refusal.pane)),
    Match.orElse(() => Option.none()),
  )

const useOpenChat = () => {
  const navigate = useNavigate()

  return React.useCallback(
    ({ machine, pane }: StartedAgent) => {
      void navigate({
        to: '/m/$machine/p/$pane',
        params: { machine, pane },
        replace: true,
        state: ({ openerKey }) => (openerKey === undefined ? {} : { openerKey }),
      })
    },
    [navigate],
  )
}

export const useLaunch = (view: Option.Option<HerdView>): Launch => {
  const [result, launch] = useAtom(launchAtom)
  const openChat = useOpenChat()
  const [attempt, setAttempt] = React.useState(Option.none<LaunchAttempt>())

  const answered = AsyncResult.isSuccess(result) ? Option.some(result.value) : Option.none()
  const receipt = Option.map(
    Option.all({ sent: attempt, agent: answered }),
    ({ sent, agent }): StartedAgent => ({ machine: sent.machine, pane: agent.pane }),
  )
  const started = pipe(
    Option.all({ herdView: view, sent: attempt, agent: answered }),
    Option.flatMap(({ herdView, sent, agent }) => startedAgent(herdView, sent.machine, agent)),
  )

  const startedPane = Option.getOrUndefined(Option.map(started, (agent) => agent.pane))
  const leftRunning = pipe(settledError(result), Option.flatMap(paneLeftRunning))

  React.useEffect(() => {
    if (Option.isSome(started)) {
      openChat(started.value)
    }
  }, [startedPane, openChat])

  return {
    pending: AsyncResult.isWaiting(result),
    opening: Option.map(receipt, (agent) => () => {
      openChat(agent)
    }),
    failure: failureMessage(result),
    blocksRestart: Option.isSome(leftRunning),
    openChatAfterFailure: pipe(
      leftRunning,
      Option.flatMap((pane) =>
        Option.map(attempt, (sent) => () => {
          openChat({ machine: sent.machine, pane })
        }),
      ),
    ),
    start: (machine, command) => {
      const key = Option.getOrElse(
        retryKey(attempt, settledError(result), machine, command),
        mintIdempotencyKey,
      )
      const next = new LaunchAttempt({ key, machine, command })

      setAttempt(Option.some(next))
      launch(next)
    },
  }
}
