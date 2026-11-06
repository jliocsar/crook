import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import type * as Schema from 'effect/Schema'

export type Step<State, Command = never> = readonly [State, readonly Command[]]

export interface Cases<Value> extends Schema.Codec<Value, unknown> {
  readonly guards: Readonly<Record<string, (value: Value) => boolean>>
}

export interface Machine<State, Event, Command = never> {
  readonly name: string
  readonly states: Cases<State>
  readonly events: Cases<Event>
  readonly initial: State
  readonly transition: (state: State, event: Event) => Step<State, Command>
}

export interface NamedStates<State> {
  readonly name: string
  readonly states: Cases<State>
}

export interface StateMark {
  readonly 'data-machine': string
  readonly 'data-state': string
}

const NOT_A_CASE = 'not a case'

export const to = <State>(state: State): Step<State> => [state, []]

export const caseNames = <Value>(cases: Pick<Cases<Value>, 'guards'>): readonly string[] =>
  Object.keys(cases.guards)

export const caseName = <Value>(cases: Pick<Cases<Value>, 'guards'>, value: Value): string =>
  pipe(
    Object.entries(cases.guards),
    Arr.findFirst(([, isCase]) => isCase(value)),
    Option.match({ onNone: () => NOT_A_CASE, onSome: ([name]) => name }),
  )

export const stateName = <State>(machine: NamedStates<State>, state: State): string =>
  caseName(machine.states, state)

export const stateMark = <State>(machine: NamedStates<State>, state: State): StateMark => ({
  'data-machine': machine.name,
  'data-state': stateName(machine, state),
})
