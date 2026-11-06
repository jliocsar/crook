import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'

import {
  delayEnded,
  fadeEnded,
  holdEnded,
  INDICATOR_BEGAN,
  INDICATOR_ENDED,
  INDICATOR_HIDDEN,
  indicatorMachine,
  IndicatorState,
} from '@crook/web/machine/IndicatorMachine'
import type { IndicatorEvent } from '@crook/web/machine/IndicatorMachine'
import { stateName } from '@crook/state-machine/Machine'
import { walk } from '@crook/state-machine/Walk'

import { indicatorWalk } from '../../charts/IndicatorWalk.ts'

const nameAfter = (events: readonly IndicatorEvent[]): string =>
  stateName(
    indicatorMachine,
    Arr.reduce(
      events,
      indicatorMachine.initial,
      (state, event) => indicatorMachine.transition(state, event)[0],
    ),
  )

const ATTEMPT = 1

describe('the indicator machine', () => {
  it('walks clean: every state reached, nothing trapped, a stale wait changes nothing', () => {
    expect(walk(indicatorWalk).findings).toEqual([])
  })

  it('shows nothing for a wait over before its delay', () => {
    expect(nameAfter([INDICATOR_BEGAN])).toBe('Delaying')
    expect(nameAfter([INDICATOR_BEGAN, INDICATOR_ENDED])).toBe('Hidden')
    expect(nameAfter([INDICATOR_BEGAN, INDICATOR_ENDED, delayEnded(ATTEMPT)])).toBe('Hidden')
  })

  it('holds through its minimum once shown, however soon the wait ends', () => {
    const shown = [INDICATOR_BEGAN, delayEnded(ATTEMPT)]

    expect(nameAfter(shown)).toBe('Holding')
    expect(nameAfter([...shown, INDICATOR_ENDED])).toBe('Lingering')
    expect(nameAfter([...shown, INDICATOR_ENDED, holdEnded(ATTEMPT)])).toBe('Leaving')
    expect(nameAfter([...shown, INDICATOR_ENDED, holdEnded(ATTEMPT), fadeEnded(ATTEMPT)])).toBe(
      'Hidden',
    )
  })

  it('leaves at once when the wait ends past its minimum', () => {
    const held = [INDICATOR_BEGAN, delayEnded(ATTEMPT), holdEnded(ATTEMPT)]

    expect(nameAfter(held)).toBe('Showing')
    expect(nameAfter([...held, INDICATOR_ENDED])).toBe('Leaving')
  })

  it('stays shown when a wait begins again before it has gone, and needs no new delay', () => {
    const shown = [INDICATOR_BEGAN, delayEnded(ATTEMPT)]

    expect(nameAfter([...shown, INDICATOR_ENDED, INDICATOR_BEGAN])).toBe('Holding')

    const leaving = [...shown, holdEnded(ATTEMPT), INDICATOR_ENDED]

    expect(nameAfter([...leaving, INDICATOR_BEGAN])).toBe('Showing')
    expect(nameAfter([...leaving, INDICATOR_BEGAN, fadeEnded(ATTEMPT)])).toBe('Showing')
  })

  it('drops what a state before this one was waiting on', () => {
    const again = [INDICATOR_BEGAN, INDICATOR_ENDED, INDICATOR_BEGAN]

    expect(nameAfter([...again, delayEnded(ATTEMPT)])).toBe('Delaying')
    expect(nameAfter([...again, delayEnded(ATTEMPT + 1)])).toBe('Holding')
  })

  it('starts one timer per step', () => {
    const [delaying, commands] = indicatorMachine.transition(INDICATOR_HIDDEN, INDICATOR_BEGAN)

    expect(IndicatorState.guards.Delaying(delaying)).toBe(true)
    expect(commands.length).toBe(1)
  })
})
