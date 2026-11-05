import { describe, expect, it } from '@effect/vitest'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import * as Schema from 'effect/Schema'

import { to } from '@crook/web/machine/Machine'
import type { Machine, Step } from '@crook/web/machine/Machine'
import { machineAtom } from '@crook/web/machine/MachineAtom'

interface WarmUp {
  readonly generation: number
  readonly wait: Duration.Duration
}

const LampState = Schema.TaggedUnion({
  Off: {},
  Warming: { generation: Schema.Int },
  On: {},
})
type LampState = typeof LampState.Type

const LampEvent = Schema.TaggedUnion({
  Switched: { on: Schema.Boolean, generation: Schema.Int },
  Warmed: { generation: Schema.Int },
})
type LampEvent = typeof LampEvent.Type

const OFF = LampState.cases.Off.make({})
const ON = LampState.cases.On.make({})
const WARM_UP_MS = 20
const SETTLE_MS = 80

const lampTransition = (state: LampState, event: LampEvent): Step<LampState, WarmUp> =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      Switched: ({ on, generation }): Step<LampState, WarmUp> =>
        on
          ? [
              LampState.cases.Warming.make({ generation }),
              [{ generation, wait: Duration.millis(WARM_UP_MS) }],
            ]
          : to(OFF),
      Warmed: ({ generation }): Step<LampState, WarmUp> =>
        to(LampState.guards.Warming(state) && state.generation === generation ? ON : state),
    }),
  )

const lamp: Machine<LampState, LampEvent, WarmUp> = {
  name: 'lamp',
  states: LampState,
  events: LampEvent,
  initial: OFF,
  transition: lampTransition,
}

const switched = (on: boolean, generation: number) =>
  LampEvent.cases.Switched.make({ on, generation })

const runtime = Atom.runtime(Layer.empty)

const driven = (first: LampEvent) => {
  const switchAtom = Atom.make<LampEvent>(first)
  const lampAtom = machineAtom({
    machine: lamp,
    observed: switchAtom,
    runtime,
    perform: ({ generation, wait }) =>
      Effect.as(Effect.sleep(wait), LampEvent.cases.Warmed.make({ generation })),
  })
  const registry = AtomRegistry.make()
  const states: LampState[] = []
  const unsubscribe = registry.subscribe(
    lampAtom,
    (state) => {
      states.push(state)
    },
    { immediate: true },
  )

  return { registry, switchAtom, states, unsubscribe, lampAtom }
}

const waitForSettle = Effect.sleep(Duration.millis(SETTLE_MS))

describe('a machine driven by an atom', () => {
  it.live('folds what it observes and feeds a finished command back in', () =>
    Effect.gen(function* () {
      const { states, unsubscribe } = driven(switched(true, 1))

      expect(states).toEqual([LampState.cases.Warming.make({ generation: 1 })])

      yield* waitForSettle

      expect(states.at(-1)).toEqual(ON)

      unsubscribe()
    }),
  )

  it.live('drops a completion whose generation the state has moved past', () =>
    Effect.gen(function* () {
      const { registry, switchAtom, states, unsubscribe } = driven(switched(true, 1))

      registry.set(switchAtom, switched(false, 2))

      yield* waitForSettle

      expect(states.at(-1)).toEqual(OFF)

      unsubscribe()
    }),
  )

  it.live('lets a new command replace the one that was running', () =>
    Effect.gen(function* () {
      const { registry, switchAtom, states, unsubscribe } = driven(switched(true, 1))

      registry.set(switchAtom, switched(true, 2))

      yield* waitForSettle

      expect(states).toEqual([
        LampState.cases.Warming.make({ generation: 1 }),
        LampState.cases.Warming.make({ generation: 2 }),
        ON,
      ])

      unsubscribe()
    }),
  )

  it.live('stops what is running once nobody reads it', () =>
    Effect.gen(function* () {
      const { states, unsubscribe } = driven(switched(true, 1))

      unsubscribe()

      yield* waitForSettle

      expect(states).toEqual([LampState.cases.Warming.make({ generation: 1 })])
    }),
  )
})
