import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'

import { afterSpring, present } from '../Dom.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import {
  answerGrows,
  following,
  ghost,
  historyOpen,
  liftOf,
  openedOn,
  phoneViewport,
  revealOf,
  scrollsUnderLift,
  VIEWPORT_HEIGHT,
} from '../ThreadRender.tsx'

const ANSWER_HEIGHT = 300
const LONG_ANSWER_HEIGHT = 5000

beforeEach(() => {
  stubMediaQueries([])
  phoneViewport()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Thread', () => {
  it.effect('morphs the working row into the answer and staggers its blocks in order', () =>
    Effect.gen(function* () {
      yield* answerGrows(ANSWER_HEIGHT)

      expect(present(ghost(), 'the working ghost').textContent).toBe('Working')
      expect(revealOf('text')).toBe('0')
      expect(revealOf('tool')).toBe('0.05')
      expect(revealOf('prompt')).toBeNull()

      yield* afterSpring(() => {
        expect(ghost()).toBeNull()
      })
    }),
  )

  it.effect('slides the thread up by what the answer added, then settles it in place', () =>
    Effect.gen(function* () {
      yield* answerGrows(ANSWER_HEIGHT)

      expect(liftOf()).toBe(`translateY(${ANSWER_HEIGHT}px)`)

      yield* afterSpring(() => {
        expect(liftOf()).toBe('translateY(0px)')
      })
    }),
  )

  it.effect('keeps following the bottom while the slide inflates the scroll height', () =>
    Effect.gen(function* () {
      yield* answerGrows(ANSWER_HEIGHT)
      scrollsUnderLift(ANSWER_HEIGHT)

      expect(following()).toBe(true)
    }),
  )

  it.effect('keeps following when the content grows under a scroll that did not move up', () =>
    Effect.sync(() => {
      const opened = historyOpen()

      opened.growsBelow(ANSWER_HEIGHT)

      expect(following()).toBe(true)
    }),
  )

  it.effect('stops following once the user scrolls up', () =>
    Effect.sync(() => {
      const opened = historyOpen()

      opened.scrollsUp(ANSWER_HEIGHT)

      expect(following()).toBe(false)
    }),
  )

  it.effect('goes back to the end when a prompt is sent from further up', () =>
    Effect.sync(() => {
      const opened = historyOpen()

      opened.scrollsUp(ANSWER_HEIGHT)
      opened.sends(ANSWER_HEIGHT)

      expect(following()).toBe(true)
      expect(opened.top()).toBe(opened.bottom())
    }),
  )

  it.effect('slides a long answer by one screen at most', () =>
    Effect.gen(function* () {
      yield* answerGrows(LONG_ANSWER_HEIGHT)

      expect(liftOf()).toBe(`translateY(${VIEWPORT_HEIGHT}px)`)
    }),
  )

  it.effect('shows the history already there on open without animating it', () =>
    Effect.sync(() => {
      openedOn(['prompt', 'text'])

      expect(revealOf('prompt')).toBeNull()
      expect(revealOf('text')).toBeNull()
    }),
  )
})
