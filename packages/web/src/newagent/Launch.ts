import { useAtom } from '@effect/atom-react/Hooks'
import { useNavigate } from '@tanstack/react-router'
import * as Cause from 'effect/Cause'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import type { AgentStarted, LaunchCommand } from '@crook/domain/Command'
import type { HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { failureMessage, settledFailure } from '@crook/web/atoms/ActionFailure'
import { LaunchAttempt, launchAtom } from '@crook/web/atoms/Launch'
import type { LaunchFailure } from '@crook/web/atoms/Launch'
import { retryKey } from '@crook/web/newagent/LaunchKey'
import { startedAgent } from '@crook/web/newagent/NewAgentLayout'
import type { StartedAgent } from '@crook/web/newagent/NewAgentLayout'
import { mintIdempotencyKey } from '@crook/web/rpc/IdempotencyKeys'

type LaunchResult = AsyncResult.AsyncResult<AgentStarted, LaunchFailure>

export interface Launch {
  readonly pending: boolean
  readonly opening: Option.Option<() => void>
  readonly failure: Option.Option<string>
  readonly openChatAfterFailure: Option.Option<() => void>
  readonly start: (machine: MachineId, command: LaunchCommand) => void
}

const failureOf = (result: LaunchResult): Option.Option<LaunchFailure> =>
  Option.flatMap(settledFailure(result), Cause.findErrorOption)

const paneLeftRunning = (failure: LaunchFailure): Option.Option<PaneId> =>
  Match.value(failure).pipe(
    Match.tag('TaskNotDelivered', (refusal) => Option.some(refusal.pane)),
    Match.orElse(() => Option.none()),
  )

const useOpenChat = () => {
  const navigate = useNavigate()

  return ({ machine, pane }: StartedAgent) => {
    void navigate({
      to: '/m/$machine/p/$pane',
      params: { machine, pane },
      replace: true,
      state: ({ openerKey }) => (openerKey === undefined ? {} : { openerKey }),
    })
  }
}

export const useLaunch = (view: Option.Option<HerdView>): Launch => {
  const [result, launch] = useAtom(launchAtom)
  const openChat = useOpenChat()
  const [attempt, setAttempt] = React.useState(Option.none<LaunchAttempt>())
  const opened = React.useRef(false)

  const answered = AsyncResult.isSuccess(result) ? Option.some(result.value) : Option.none()
  const receipt = Option.map(
    Option.all({ sent: attempt, agent: answered }),
    ({ sent, agent }): StartedAgent => ({ machine: sent.machine, pane: agent.pane }),
  )
  const started = pipe(
    Option.all({ herdView: view, sent: attempt, agent: answered }),
    Option.flatMap(({ herdView, sent, agent }) => startedAgent(herdView, sent.machine, agent)),
  )

  React.useEffect(() => {
    if (Option.isSome(started) && !opened.current) {
      opened.current = true
      openChat(started.value)
    }
  }, [started, openChat])

  return {
    pending: AsyncResult.isWaiting(result),
    opening: Option.map(receipt, (agent) => () => {
      openChat(agent)
    }),
    failure: failureMessage(result),
    openChatAfterFailure: pipe(
      failureOf(result),
      Option.flatMap(paneLeftRunning),
      Option.flatMap((pane) =>
        Option.map(attempt, (sent) => () => {
          openChat({ machine: sent.machine, pane })
        }),
      ),
    ),
    start: (machine, command) => {
      const key = Option.getOrElse(
        retryKey(attempt, failureOf(result), machine, command),
        mintIdempotencyKey,
      )
      const next = new LaunchAttempt({ key, machine, command })

      setAttempt(Option.some(next))
      launch(next)
    },
  }
}
