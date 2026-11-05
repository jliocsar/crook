import { describe, expect, it } from '@effect/vitest'
import { act, renderHook } from '@testing-library/react'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { vi } from 'vitest'

import { to } from '@crook/web/machine/Machine'
import type { Machine, Step } from '@crook/web/machine/Machine'
import { useMachine } from '@crook/web/machine/UseMachine'

const ProbeState = Schema.TaggedUnion({ Idle: {}, Waiting: {}, Finished: {} })
type ProbeState = typeof ProbeState.Type

const ProbeEvent = Schema.TaggedUnion({ Start: {}, Finish: {} })
type ProbeEvent = typeof ProbeEvent.Type

const START = ProbeEvent.cases.Start.make({})
const FINISH = ProbeEvent.cases.Finish.make({})
const WAIT_COMMAND = 'wait'
const SHORT_WAIT = Duration.millis(30)
const PAST_THE_WAIT = Duration.millis(90)

const probeTransition = (state: ProbeState, event: ProbeEvent): Step<ProbeState, string> =>
  ProbeEvent.guards.Start(event)
    ? [ProbeState.cases.Waiting.make({}), [WAIT_COMMAND]]
    : to(ProbeState.guards.Waiting(state) ? ProbeState.cases.Finished.make({}) : state)

const probeMachine: Machine<ProbeState, ProbeEvent, string> = {
  name: 'probe',
  states: ProbeState,
  events: ProbeEvent,
  initial: ProbeState.cases.Idle.make({}),
  transition: probeTransition,
}

const sleepThenFinish = () => Effect.as(Effect.sleep(SHORT_WAIT), FINISH)

describe('the React driver of a machine', () => {
  it('runs a command that finishes at once and feeds its event back', () => {
    const { result } = renderHook(() => useMachine(probeMachine, () => Effect.succeed(FINISH)))

    act(() => {
      result.current[1](START)
    })

    expect(ProbeState.guards.Finished(result.current[0])).toBe(true)
  })

  it.live('feeds back the event of a command that takes a while', () =>
    Effect.gen(function* () {
      const { result } = renderHook(() => useMachine(probeMachine, sleepThenFinish))

      act(() => {
        result.current[1](START)
      })

      expect(ProbeState.guards.Waiting(result.current[0])).toBe(true)

      yield* Effect.sleep(PAST_THE_WAIT)

      expect(ProbeState.guards.Finished(result.current[0])).toBe(true)
    }),
  )

  it.live('interrupts what is running when it unmounts, so no event lands after', () =>
    Effect.gen(function* () {
      const transition = vi.fn(probeTransition)
      const counted = { ...probeMachine, transition }
      const { result, unmount } = renderHook(() => useMachine(counted, sleepThenFinish))

      act(() => {
        result.current[1](START)
      })
      unmount()
      yield* Effect.sleep(PAST_THE_WAIT)

      expect(transition).toHaveBeenCalledTimes(1)
    }),
  )
})
