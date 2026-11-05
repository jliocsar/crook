import * as Arr from 'effect/Array'
import type * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'

import type { Machine } from '@crook/web/machine/Machine'

export interface MachineDriver<State, Event, Command, Services, RuntimeFailure> {
  readonly machine: Machine<State, Event, Command>
  readonly observed: Atom.Atom<Event>
  readonly runtime: Atom.AtomRuntime<Services, RuntimeFailure>
  readonly perform: (command: Command) => Effect.Effect<Event, never, Services>
}

export const machineAtom = <State, Event, Command, Services, RuntimeFailure>({
  machine,
  observed,
  runtime,
  perform,
}: MachineDriver<State, Event, Command, Services, RuntimeFailure>): Atom.Atom<State> => {
  const running = runtime.fn(perform)

  return Atom.make((get) => {
    const start = (commands: readonly Command[]) => {
      Arr.forEach(commands, (command) => {
        get.set(running, command)
      })
    }

    const dispatch = (event: Event) => {
      Option.map(get.self<State>(), (current) => {
        const [next, commands] = machine.transition(current, event)

        get.setSelf(next)
        start(commands)
      })
    }

    get.mount(running)
    get.subscribe(running, (result) => {
      if (AsyncResult.isSuccess(result) && !result.waiting) {
        dispatch(result.value)
      }
    })
    get.subscribe(observed, dispatch)

    const [first, commands] = machine.transition(machine.initial, get.once(observed))

    start(commands)

    return first
  })
}
