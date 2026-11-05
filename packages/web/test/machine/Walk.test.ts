import { describe, expect, it } from '@effect/vitest'
import * as Match from 'effect/Match'
import * as Schema from 'effect/Schema'

import { to } from '@crook/web/machine/Machine'
import type { Machine, Step } from '@crook/web/machine/Machine'
import { chartOf, walk, WalkFinding } from '@crook/web/machine/Walk'
import type { Walk, WalkSpec } from '@crook/web/machine/Walk'

const DoorState = Schema.TaggedUnion({
  Closed: {},
  Open: {},
  Locked: { attempts: Schema.Int },
})
type DoorState = typeof DoorState.Type

const DoorEvent = Schema.TaggedUnion({
  Push: {},
  Pull: {},
  Lock: {},
})
type DoorEvent = typeof DoorEvent.Type

const CLOSED = DoorState.cases.Closed.make({})
const OPEN = DoorState.cases.Open.make({})
const PUSH = DoorEvent.cases.Push.make({})
const PULL = DoorEvent.cases.Pull.make({})
const LOCK = DoorEvent.cases.Lock.make({})

const locked = (attempts: number) => DoorState.cases.Locked.make({ attempts })

const doorTransition = (state: DoorState, event: DoorEvent): Step<DoorState> =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      Push: () => to(DoorState.guards.Closed(state) ? OPEN : state),
      Pull: () =>
        to(DoorState.guards.Open(state) || DoorState.guards.Locked(state) ? CLOSED : state),
      Lock: () => to(DoorState.guards.Closed(state) ? locked(0) : state),
    }),
  )

const door: Machine<DoorState, DoorEvent> = {
  name: 'door',
  states: DoorState,
  events: DoorEvent,
  initial: CLOSED,
  transition: doorTransition,
}

const doorWalk = (
  overrides: Partial<WalkSpec<DoorState, DoorEvent, never>> & {
    readonly transition?: Machine<DoorState, DoorEvent>['transition']
  } = {},
) =>
  walk<DoorState, DoorEvent, never>({
    machine: { ...door, transition: overrides.transition ?? doorTransition },
    events: () => [PUSH, PULL, LOCK],
    invariants: [],
    home: DoorState.guards.Closed,
    ...overrides,
  })

const findingsOf = (walked: Walk<DoorState, DoorEvent, never>) => walked.findings

describe('the machine walker', () => {
  it('walks a sound table without a finding and reaches every state', () => {
    const walked = doorWalk()

    expect(findingsOf(walked)).toEqual([])
    expect(walked.states.length).toBe(3)
    expect(walked.arrows.length).toBe(9)
  })

  it('catches a broken transition table through an invariant, naming the path to it', () => {
    const walked = doorWalk({
      transition: (state, event) =>
        DoorState.guards.Open(state) && DoorEvent.guards.Lock(event)
          ? to(locked(0))
          : doorTransition(state, event),
      invariants: [
        {
          name: 'a door is only locked once it is shut',
          holds: (state) => !DoorState.guards.Locked(state) || state.attempts === 1,
        },
      ],
    })

    expect(findingsOf(walked)).toContainEqual(
      WalkFinding.BrokenInvariant({
        invariant: 'a door is only locked once it is shut',
        state: 'Locked',
        path: ['Lock'],
      }),
    )
  })

  it('catches a transition that is not total', () => {
    const walked = doorWalk({
      transition: (state, event) => {
        if (DoorState.guards.Open(state) && DoorEvent.guards.Pull(event)) {
          throw new Error('nobody wrote this arrow')
        }

        return doorTransition(state, event)
      },
    })

    expect(findingsOf(walked)).toContainEqual(
      WalkFinding.NotTotal({
        from: 'Open',
        event: 'Pull',
        detail: 'Error: nobody wrote this arrow',
      }),
    )
  })

  it('catches a transition that returns something the schema refuses', () => {
    const walked = doorWalk({
      transition: (state, event) =>
        DoorEvent.guards.Lock(event) && DoorState.guards.Closed(state)
          ? to({ _tag: 'Locked', attempts: 0.5 })
          : doorTransition(state, event),
    })

    expect(findingsOf(walked)).toContainEqual(
      WalkFinding.NotAState({ from: 'Closed', event: 'Lock' }),
    )
  })

  it('catches an unreachable state', () => {
    const walked = doorWalk({
      transition: (state, event) =>
        DoorEvent.guards.Lock(event) ? to(state) : doorTransition(state, event),
    })

    expect(findingsOf(walked)).toEqual([WalkFinding.Unreachable({ state: 'Locked' })])
  })

  it('catches a dead end, a state nothing leads out of', () => {
    const walked = doorWalk({
      transition: (state, event) =>
        DoorState.guards.Locked(state) ? to(state) : doorTransition(state, event),
    })

    expect(findingsOf(walked)).toEqual([WalkFinding.DeadEnd({ state: 'Locked', path: ['Lock'] })])
  })

  it('lets a declared end state stay forever', () => {
    const walked = doorWalk({
      transition: (state, event) =>
        DoorState.guards.Locked(state) ? to(state) : doorTransition(state, event),
      terminal: DoorState.guards.Locked,
    })

    expect(findingsOf(walked)).toEqual([])
  })

  it('catches two states that only lead to each other, away from home', () => {
    const walked = doorWalk({
      transition: (state, event) => {
        if (DoorState.guards.Open(state)) {
          return to(DoorEvent.guards.Lock(event) ? locked(0) : state)
        }

        if (DoorState.guards.Locked(state)) {
          return to(DoorEvent.guards.Pull(event) ? OPEN : state)
        }

        return doorTransition(state, event)
      },
    })

    expect(findingsOf(walked)).toEqual(
      expect.arrayContaining([
        WalkFinding.DeadEnd({ state: 'Open', path: ['Push'] }),
        WalkFinding.DeadEnd({ state: 'Locked', path: ['Lock'] }),
      ]),
    )
  })

  it('catches an event the walk never tried', () => {
    const walked = doorWalk({ events: () => [PUSH, PULL], transition: doorTransition })

    expect(findingsOf(walked)).toEqual(
      expect.arrayContaining([WalkFinding.EventNeverOffered({ event: 'Lock' })]),
    )
  })

  it('stops and says so when a counter makes the states endless', () => {
    const walked = doorWalk({
      stateLimit: 16,
      transition: (state, event) =>
        DoorState.guards.Locked(state) && DoorEvent.guards.Push(event)
          ? to(locked(state.attempts + 1))
          : doorTransition(state, event),
    })

    expect(findingsOf(walked)).toContainEqual(WalkFinding.TooManyStates({ limit: 16 }))
  })

  it('breaks an arrow rule, such as a stale completion that moved the state', () => {
    const walked = doorWalk({
      arrowRules: [
        {
          name: 'pushing never closes a door',
          holds: ({ event, to: target }) =>
            !(DoorEvent.guards.Push(event) && DoorState.guards.Closed(target)),
        },
      ],
      transition: (state, event) =>
        DoorEvent.guards.Push(event) && DoorState.guards.Open(state)
          ? to(CLOSED)
          : doorTransition(state, event),
    })

    expect(findingsOf(walked)).toContainEqual(
      WalkFinding.BrokenArrow({
        rule: 'pushing never closes a door',
        from: 'Open',
        event: 'Push',
        to: 'Closed',
      }),
    )
  })

  it('draws the table it walked, with no arrow for an event that stays', () => {
    expect(chartOf(doorWalk())).toBe(
      [
        'stateDiagram-v2',
        '  [*] --> Closed',
        '  state "from any state" as Anywhere',
        '  Closed --> Open: Push',
        '  Closed --> Locked: Lock',
        '  Anywhere --> Closed: Pull',
        '',
      ].join('\n'),
    )
  })
})
