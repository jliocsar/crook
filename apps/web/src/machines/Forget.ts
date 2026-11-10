import { useAtom } from '@effect/atom-react/Hooks'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as React from 'react'

import type { MachineId } from '@crook/domain/Ids'
import type { MachineConnection } from '@crook/domain/Machine'
import { failureMessage } from '@crook/web/atoms/ActionFailure'
import { forgetMachineAtom } from '@crook/web/atoms/Machines'

export interface ForgetClearsWhen {
  readonly connection: MachineConnection
  readonly controlsEnabled: boolean
}

export const useForgetMachine = (
  machine: MachineId,
  { connection, controlsEnabled }: ForgetClearsWhen,
) => {
  const [result, request] = useAtom(forgetMachineAtom(machine), { mode: 'promiseExit' })
  const [requested, setRequested] = React.useState(false)
  const settled = Option.liftPredicate(
    result,
    (current) => requested && !AsyncResult.isWaiting(current),
  )

  React.useEffect(() => {
    setRequested(false)
  }, [connection, controlsEnabled])

  return {
    pending: AsyncResult.isWaiting(result),
    forgotten: Option.exists(settled, AsyncResult.isSuccess),
    failure: Option.flatMap(settled, failureMessage),
    forget: () => {
      setRequested(true)
      void request()
    },
  }
}
