import { RegistryContext } from '@effect/atom-react/RegistryContext'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as React from 'react'

import type { MachineId } from '@crook/domain/Ids'
import { forgetMachine } from '@crook/web/atoms/Machines'

export const useForgetMachine = (onForgotten: () => void) => {
  const registry = React.useContext(RegistryContext)
  const [failure, setFailure] = React.useState(Option.none<string>())

  const forget = (machine: MachineId) => {
    setFailure(Option.none())
    Effect.runCallback(forgetMachine(registry, machine), {
      onExit: (exit) => {
        if (Exit.isSuccess(exit)) {
          onForgotten()

          return
        }

        setFailure(Option.map(Cause.findErrorOption(exit.cause), (error) => error.message))
      },
    })
  }

  return { failure, forget }
}
