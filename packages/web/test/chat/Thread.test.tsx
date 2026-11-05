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
  holeFills,
  holeFillsWhileAway,
  liftOf,
  lifted,
  liftsWritten,
  liveTail,
  fades,
  openedOn,
  phoneViewport,
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
const OPENING_ROW_HEIGHTS = [130, 140, 150, 160, 170]
const OPENING_MEASURE_GAP_MS = 100

beforeEach(() => {
  stubMediaQueries([])
  phoneViewport()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Thread', () => {
  it.effect(
    'fades the working row out over the answer, which lands without a fade of its own',
    () =>
      Effect.gen(function* () {
        yield* answerGrows(ANSWER_HEIGHT)

        expect(present(ghost(), 'the working ghost').textContent).toBe('Working')
        expect(fades('text')).toBe(false)
        expect(fades('tool')).toBe(false)

        yield* afterSpring(() => {
          expect(ghost()).toBeNull()
        })
      }),
  )

  it.effect('fades the working row out even when the rows keep their count and last row', () =>
    Effect.gen(function* () {
      const tail = yield* liveTail([{ key: 'failure', content: <p>Try again</p> }])

      tail.lands(['text'], ANSWER_HEIGHT)

      expect(present(ghost(), 'the working ghost').textContent).toBe('Working')
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

  it.effect('lifts nothing when what grew filled a hole above the end', () =>
    Effect.gen(function* () {
      yield* holeFills(ANSWER_HEIGHT)

      expect(lifted()).toBe(0)
      expect(following()).toBe(true)
    }),
  )

  it.effect('lifts the next answer after a hole filled while the thread was scrolled away', () =>
    Effect.gen(function* () {
      const { followedWhileAway, followedBack } = yield* holeFillsWhileAway(ANSWER_HEIGHT)

      expect(followedWhileAway).toBe(false)
      expect(followedBack).toBe(true)
      expect(lifted()).toBe(ANSWER_HEIGHT)
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

  it.effect('keeps following a correction after a mouse press released outside the thread', () =>
    Effect.sync(() => {
      const opened = historyOpen()

      opened.mouseReleasedOutside()
      opened.correctedUp(SHORT_SCROLL)

      expect(following()).toBe(true)
    }),
  )

  it.effect('keeps following a correction after a click that scrolled nothing', () =>
    Effect.sync(() => {
      const opened = historyOpen()

      opened.clicked()
      opened.correctedUp(SHORT_SCROLL)

      expect(following()).toBe(true)
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

  it.effect('lifts nothing while the first measures of an open keep growing it', () =>
    Effect.gen(function* () {
      const opened = rowsShrinkAfterOpen(MANY_ROWS, RENDERED_ROW_HEIGHT, SHORT_ROW_HEIGHT)
      const lifts = liftsWritten()

      yield* Effect.forEach(
        OPENING_ROW_HEIGHTS,
        (height) =>
          Effect.andThen(
            Effect.sync(() => {
              opened.measured(height)
            }),
            wait(OPENING_MEASURE_GAP_MS),
          ),
        { discard: true },
      )

      expect(lifts().filter((pixels) => pixels !== 0)).toStrictEqual([])
    }),
  )

  it.effect('lifts what grows once the first measures of an open have gone quiet', () =>
    Effect.gen(function* () {
      const opened = rowsShrinkAfterOpen(MANY_ROWS, RENDERED_ROW_HEIGHT, SHORT_ROW_HEIGHT)

      opened.measured(RENDERED_ROW_HEIGHT)
      yield* wait(SETTLE_MS)
      opened.measured(RENDERED_ROW_HEIGHT + SHORT_ROW_HEIGHT)

      expect(lifted()).toBeGreaterThan(0)
    }),
  )

  it.effect('shows the history already there on open without animating it', () =>
    Effect.sync(() => {
      openedOn(['prompt', 'text'])

      expect(fades('prompt')).toBe(false)
      expect(fades('text')).toBe(false)
    }),
  )
})
