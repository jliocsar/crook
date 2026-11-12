import { useAtomValue } from '@effect/atom-react/Hooks'
import { RegistryContext } from '@effect/atom-react/RegistryContext'
import { useNavigate } from '@tanstack/react-router'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import * as React from 'react'

import type { AgentStarted, LaunchCommand } from '@crook/domain/Command'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { settledError } from '@crook/web/atoms/ActionFailure'
import {
  ActionProgress,
  failureMessageOf,
  isDone,
  isSending,
  isSent,
  isUnconfirmed,
} from '@crook/web/atoms/ActionProgress'
import { LaunchAttempt, launchAtom, launchProgressAtom } from '@crook/web/atoms/Launch'
import type { LaunchFailure } from '@crook/web/atoms/Launch'
import { retryKey } from '@crook/web/newagent/LaunchKey'
import type { StartedAgent } from '@crook/web/newagent/NewAgentLayout'
import { mintIdempotencyKey } from '@crook/web/rpc/IdempotencyKeys'
import { carriedOpener } from '@crook/web/navigation/Opener'

export interface Launch {
  readonly pending: boolean
  readonly opening: Option.Option<() => void>
  readonly failure: Option.Option<string>
  readonly openChatAfterFailure: Option.Option<() => void>
  readonly blocksRestart: boolean
  readonly start: (machine: MachineId, command: LaunchCommand) => void
}

const NOT_SHOWN_NOTE =
  'Claude started, but this machine has not shown its pane yet. Open the chat, or change something and start again if it never appears.'

const NOTHING_SENT = Atom.make(AsyncResult.initial<AgentStarted, LaunchFailure>())
const NO_PROGRESS = Atom.make(ActionProgress.Idle<AgentStarted>())

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
        state: carriedOpener,
      })
    },
    [navigate],
  )
}

export const useLaunch = (): Launch => {
  const registry = React.useContext(RegistryContext)
  const openChat = useOpenChat()
  const [attempt, setAttempt] = React.useState(Option.none<LaunchAttempt>())
  const progress = useAtomValue(
    Option.match(attempt, { onNone: () => NO_PROGRESS, onSome: launchProgressAtom }),
  )
  const result = useAtomValue(
    Option.match(attempt, {
      onNone: () => NOTHING_SENT,
      onSome: (sent) => launchAtom(sent.key),
    }),
  )

  const openPane = (pane: PaneId) =>
    Option.map(attempt, (sent) => () => {
      openChat({ machine: sent.machine, pane })
    })
  const paneOf = (holds: (state: ActionProgress<AgentStarted>) => boolean) =>
    pipe(
      Option.liftPredicate(result, () => holds(progress)),
      Option.flatMap(AsyncResult.value),
      Option.map((agent) => agent.pane),
    )
  const startedPane = Option.getOrUndefined(paneOf(isDone))
  const notShown = paneOf(isUnconfirmed)
  const leftRunning = pipe(settledError(result), Option.flatMap(paneLeftRunning))

  React.useEffect(() => {
    if (startedPane !== undefined) {
      Option.map(openPane(startedPane), (open) => {
        open()
      })
    }
  }, [startedPane, openChat])

  return {
    pending: isSending(progress),
    opening: Option.flatMap(
      paneOf((state) => isSent(state) || isDone(state)),
      openPane,
    ),
    failure: Option.orElse(failureMessageOf(progress), () => Option.as(notShown, NOT_SHOWN_NOTE)),
    blocksRestart: Option.isSome(leftRunning) || Option.isSome(notShown),
    openChatAfterFailure: Option.flatMap(
      Option.orElse(leftRunning, () => notShown),
      openPane,
    ),
    start: (machine, command) => {
      const key = Option.getOrElse(
        retryKey(attempt, settledError(result), machine, command),
        mintIdempotencyKey,
      )
      const next = new LaunchAttempt({ key, machine, command })

      setAttempt(Option.some(next))
      registry.set(launchAtom(key), next)
    },
  }
}
