import { fireEvent } from '@testing-library/react'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'

import { eventually, present } from './Dom.ts'
import { chunk, said } from './TranscriptFixtures.ts'

const MANY_LINES = 120
const LINE_BYTES = 10

export const TALL_SCROLL_HEIGHT = 100_000

export const tallViewport = () => {
  const viewport = present(
    document.querySelector<HTMLElement>('[data-slot="conversation-viewport"]'),
    'The thread',
  )

  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: TALL_SCROLL_HEIGHT })

  return viewport
}

export const followedToBottom = Effect.fn('followedToBottom')(function* (viewport: HTMLElement) {
  yield* eventually(() => {
    expect(viewport.scrollTop).toBe(TALL_SCROLL_HEIGHT)
  })
  fireEvent.scroll(viewport)
})

export const fingerScrollsToTop = (viewport: HTMLElement) => {
  fireEvent.touchStart(viewport)
  viewport.scrollTop = 0
  fireEvent.scroll(viewport)
  fireEvent.touchEnd(viewport)
}

export const isFollowing = (viewport: HTMLElement): boolean =>
  viewport.hasAttribute('data-following')

export const manyLines = (from: number) =>
  chunk(
    from,
    from + MANY_LINES * LINE_BYTES,
    Arr.makeBy(MANY_LINES, (index) => said(from + index * LINE_BYTES, `Line ${index}`)),
  )
