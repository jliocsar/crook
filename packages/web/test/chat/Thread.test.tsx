import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'

import { afterSpring, present, wait } from '../Dom.ts'
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
  rowsShrinkAfterOpen,
  SETTLE_MS,
  VIEWPORT_HEIGHT,
} from '../ThreadRender.tsx'

const ANSWER_HEIGHT = 300
const LONG_ANSWER_HEIGHT = 5000
const SHORT_SCROLL = 100
const NUDGE = 20
const MANY_ROWS = 60
const RENDERED_ROW_HEIGHT = 120
const SHORT_ROW_HEIGHT = 20

beforeEach(() => {
  stubMediaQueries([])
  phoneViewport()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

  it.effect('stops following once a finger scrolls up', () =>
    Effect.sync(() => {
      const opened = historyOpen()

      opened.fingerScrollsUp(ANSWER_HEIGHT)

      expect(following()).toBe(false)
    }),
  )

  it.effect('stops following once the wheel scrolls up', () =>
    Effect.sync(() => {
      const opened = historyOpen()

      opened.wheelsUp(ANSWER_HEIGHT)

      expect(following()).toBe(false)
    }),
  )

  it.effect('keeps following when the virtualizer corrects the scroll upward', () =>
    Effect.sync(() => {
      const opened = historyOpen()

      opened.correctedUp(ANSWER_HEIGHT)

      expect(following()).toBe(true)
    }),
  )

  it.effect('keeps the virtualizer from correcting the scroll while it follows', () =>
    Effect.gen(function* () {
      const opened = rowsShrinkAfterOpen(MANY_ROWS, RENDERED_ROW_HEIGHT, SHORT_ROW_HEIGHT)

      opened.measured()
      yield* wait(SETTLE_MS)

      expect(opened.corrections()).toBe(0)
      expect(opened.top()).toBe(opened.bottom())
      expect(following()).toBe(true)
    }),
  )

  it.effect('pins back to the end once a corrected scroll settles', () =>
    Effect.gen(function* () {
      const opened = historyOpen()

      yield* wait(SETTLE_MS)
      opened.correctedUp(SHORT_SCROLL)
      yield* wait(SETTLE_MS)

      expect(opened.top()).toBe(opened.bottom())
    }),
  )

  it.effect('stays where a finger left it once its scroll settles', () =>
    Effect.gen(function* () {
      const opened = historyOpen()

      yield* wait(SETTLE_MS)
      opened.fingerScrollsUp(SHORT_SCROLL)
      yield* wait(SETTLE_MS)

      expect(opened.top()).toBe(opened.bottom() - SHORT_SCROLL)
    }),
  )

  it.effect('stays where a small nudge left it while it keeps following', () =>
    Effect.gen(function* () {
      const opened = historyOpen()

      yield* wait(SETTLE_MS)
      opened.fingerScrollsUp(NUDGE)
      yield* wait(SETTLE_MS)

      expect(opened.top()).toBe(opened.bottom() - NUDGE)
      expect(following()).toBe(true)
    }),
  )

  it.effect('stays where a mouse drag on the scrollbar left it once its scroll settles', () =>
    Effect.gen(function* () {
      const opened = historyOpen()

      yield* wait(SETTLE_MS)
      opened.mouseDragsUp(NUDGE)
      yield* wait(SETTLE_MS)

      expect(opened.top()).toBe(opened.bottom() - NUDGE)
    }),
  )

  it.effect('keeps following a correction once a wheel scroll has settled', () =>
    Effect.gen(function* () {
      const opened = historyOpen()

      yield* wait(SETTLE_MS)
      opened.wheelsUp(NUDGE)
      yield* wait(SETTLE_MS)
      opened.correctedUp(SHORT_SCROLL)

      expect(following()).toBe(true)
    }),
  )

  it.effect('stays on the row it jumped to once that scroll settles', () =>
    Effect.gen(function* () {
      const opened = historyOpen()

      yield* wait(SETTLE_MS)
      opened.jumpsTo('prompt')
      yield* wait(SETTLE_MS)

      expect(following()).toBe(false)
      expect(opened.top()).toBeLessThan(opened.bottom())
    }),
  )

  it.effect('goes back to the end when Latest is pressed', () =>
    Effect.gen(function* () {
      const opened = historyOpen()

      opened.fingerScrollsUp(SHORT_SCROLL)
      opened.pressesLatest()
      yield* wait(SETTLE_MS)

      expect(opened.top()).toBe(opened.bottom())
      expect(following()).toBe(true)
    }),
  )

  it.effect('goes back to the end when a prompt is sent from further up', () =>
    Effect.sync(() => {
      const opened = historyOpen()

      opened.fingerScrollsUp(ANSWER_HEIGHT)
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
