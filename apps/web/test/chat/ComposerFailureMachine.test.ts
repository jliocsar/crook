import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

import {
  composerFailureMachine,
  composerFailureMessage,
  draftChanged,
  PROMPT_SENT,
  promptRefused,
  STOP_PRESSED,
  stopRefused,
  TURN_ENDED,
} from '@crook/web/chat/ComposerFailureMachine'
import type { ComposerFailureEvent } from '@crook/web/chat/ComposerFailureMachine'
import { walk } from '@crook/state-machine/Walk'

import { composerFailureWalk } from '../../charts/ComposerFailureWalk.ts'

const MESSAGE = 'Herdr is not answering.'
const TEXT = 'Fix the banner'

const shownAfter = (events: readonly ComposerFailureEvent[]) =>
  composerFailureMessage(
    Arr.reduce(
      events,
      composerFailureMachine.initial,
      (state, event) => composerFailureMachine.transition(state, event)[0],
    ),
  )

describe('the composer failure machine', () => {
  it('walks clean', () => {
    expect(walk(composerFailureWalk).findings).toEqual([])
  })

  it('keeps a refused prompt up while the field holds what it refused', () => {
    const refused = promptRefused(MESSAGE, TEXT)

    expect(shownAfter([refused])).toEqual(Option.some(MESSAGE))
    expect(shownAfter([refused, draftChanged(TEXT)])).toEqual(Option.some(MESSAGE))
  })

  it('clears a refused prompt when the draft moves on or the next send goes', () => {
    const refused = promptRefused(MESSAGE, TEXT)

    expect(shownAfter([refused, draftChanged(`${TEXT}!`)])).toEqual(Option.none())
    expect(shownAfter([refused, draftChanged('')])).toEqual(Option.none())
    expect(shownAfter([refused, PROMPT_SENT])).toEqual(Option.none())
  })

  it('clears a failed stop when pressed again or when the turn ends, not on typing', () => {
    const refused = stopRefused(MESSAGE)

    expect(shownAfter([refused, draftChanged(TEXT)])).toEqual(Option.some(MESSAGE))
    expect(shownAfter([refused, STOP_PRESSED])).toEqual(Option.none())
    expect(shownAfter([refused, TURN_ENDED])).toEqual(Option.none())
  })

  it('keeps a refused prompt through a turn ending, since the words are still unsent', () => {
    expect(shownAfter([promptRefused(MESSAGE, TEXT), TURN_ENDED])).toEqual(Option.some(MESSAGE))
  })
})
