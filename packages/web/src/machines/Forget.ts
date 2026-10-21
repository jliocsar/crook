import { useAtom } from '@effect/atom-react/Hooks'
import * as Cause from 'effect/Cause'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import type { MachineId } from '@crook/domain/Ids'
import { forgetMachineAtom } from '@crook/web/atoms/Machines'

export const useForgetMachine = (machine: MachineId, clearsWhenChanged: string) => {
  const [result, request] = useAtom(forgetMachineAtom(machine), { mode: 'promiseExit' })
  const [requested, setRequested] = React.useState(false)
  const outcome = Option.liftPredicate(result, () => requested)
  const settled = Option.filter(outcome, (current) => !AsyncResult.isWaiting(current))

  React.useEffect(() => {
    setRequested(false)
  }, [clearsWhenChanged])

  return {
    pending: Option.exists(outcome, AsyncResult.isWaiting),
    forgotten: Option.exists(settled, AsyncResult.isSuccess),
    failure: pipe(
      settled,
      Option.flatMap(AsyncResult.cause),
      Option.flatMap(Cause.findErrorOption),
      Option.map((error) => error.message),
    ),
    forget: () => {
      setRequested(true)
      void request()
    },
  }
}
