import * as Context from 'effect/Context'
import type * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Equal from 'effect/Equal'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'

import { RECONNECT_GRACE } from '@crook/protocol/AgentLink'
import {
  answered,
  SETTLED,
  sentWaitMachine,
  SentWaitState,
  sentWaitTimer,
} from '@crook/web/actions/SentWaitMachine'
import type { SentWaitEvent } from '@crook/web/actions/SentWaitMachine'
import { ActionProgress, isSent } from '@crook/web/atoms/ActionProgress'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { machineAtom } from '@crook/web/machine/MachineAtom'

export const SentBound = Context.Reference<Duration.Duration>('@crook/web/atoms/SentBound', {
  defaultValue: () => RECONNECT_GRACE,
})

export const sentWaitEventOf = <Receipt, Failure>(
  progress: ActionProgress<Receipt>,
  result: AsyncResult.AsyncResult<Receipt, Failure>,
): SentWaitEvent =>
  isSent(progress) && AsyncResult.isSuccess(result) ? answered(result.timestamp) : SETTLED

export const withSentWait = <Receipt>(
  progress: ActionProgress<Receipt>,
  wait: SentWaitState,
): ActionProgress<Receipt> =>
  isSent(progress) && SentWaitState.guards.Unconfirmed(wait)
    ? ActionProgress.Unconfirmed({ receipt: progress.receipt })
    : progress

export const boundedProgressAtom = <Receipt, Failure>({
  result,
  progress,
  bound,
}: {
  readonly result: Atom.Atom<AsyncResult.AsyncResult<Receipt, Failure>>
  readonly progress: (get: Atom.AtomContext) => ActionProgress<Receipt>
  readonly bound: Effect.Effect<Duration.Duration>
}): Atom.Atom<ActionProgress<Receipt>> => {
  const progressNow = Atom.make(progress).pipe(Atom.withEquality(Equal.equals))
  const wait = machineAtom({
    machine: sentWaitMachine,
    observed: Atom.make((get) => sentWaitEventOf(get(progressNow), get(result))).pipe(
      Atom.withEquality(Equal.equals),
    ),
    runtime: hubRuntime,
    perform: (command) => Effect.flatMap(bound, (duration) => sentWaitTimer(duration)(command)),
  })

  return Atom.make((get) => withSentWait(get(progressNow), get(wait))).pipe(
    Atom.withEquality(Equal.equals),
  )
}
