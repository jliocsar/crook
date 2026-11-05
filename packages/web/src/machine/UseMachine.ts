import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { constVoid } from 'effect/Function'
import * as React from 'react'

import type { Machine } from '@crook/web/machine/Machine'

export const useMachine = <State, Event, Command>(
  machine: Machine<State, Event, Command>,
  perform: (command: Command) => Effect.Effect<Event>,
): readonly [State, (event: Event) => void] => {
  const [state, setState] = React.useState(machine.initial)
  const current = React.useRef(machine.initial)
  const running = React.useRef(new Set<() => void>())

  const dispatch = React.useCallback(
    (event: Event) => {
      const [next, commands] = machine.transition(current.current, event)

      current.current = next
      setState(next)
      Arr.forEach(commands, (command) => {
        const finish = Effect.runCallback(perform(command), {
          onExit: (exit) => {
            running.current.delete(finish)
            Exit.match(exit, {
              onSuccess: dispatch,
              onFailure: constVoid,
            })
          },
        })

        running.current.add(finish)
      })
    },
    [machine, perform],
  )

  React.useEffect(
    () => () => {
      Arr.forEach(Array.from(running.current), (cancel) => {
        cancel()
      })
      running.current.clear()
      current.current = machine.initial
    },
    [machine],
  )

  return [state, dispatch]
}
