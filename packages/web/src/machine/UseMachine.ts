import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import { constVoid } from 'effect/Function'
import * as React from 'react'

import type { Machine } from '@crook/web/machine/Machine'

export const useMachine = <State, Event, Command>(
  machine: Machine<State, Event, Command>,
  perform: (command: Command) => Effect.Effect<Event>,
): readonly [State, (event: Event) => void] => {
  const [state, setState] = React.useState(machine.initial)
  const current = React.useRef(machine.initial)
  const running = React.useRef(new Set<Fiber.Fiber<Event>>())

  const dispatch = React.useCallback(
    (event: Event) => {
      const [next, commands] = machine.transition(current.current, event)

      current.current = next
      setState(next)
      Arr.forEach(commands, (command) => {
        const fiber = Effect.runFork(
          perform(command).pipe(
            Effect.tapDefect((defect) => Effect.logError('A machine command died', defect)),
          ),
        )

        running.current.add(fiber)
        fiber.addObserver((exit) => {
          running.current.delete(fiber)
          Exit.match(exit, {
            onSuccess: dispatch,
            onFailure: constVoid,
          })
        })
      })
    },
    [machine, perform],
  )

  React.useEffect(
    () => () => {
      Effect.runFork(Fiber.interruptAll(Array.from(running.current)))
      running.current.clear()
      current.current = machine.initial
      setState(machine.initial)
    },
    [machine],
  )

  return [state, dispatch]
}
