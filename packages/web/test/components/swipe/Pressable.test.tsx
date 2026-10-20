import { describe, expect, it } from '@effect/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'

import { LONG_PRESS_MS } from '@/components/swipe/Gestures'
import { Pressable } from '@/components/swipe/Pressable'

const advance = (milliseconds: number) =>
  Effect.promise(() => vi.advanceTimersByTimeAsync(milliseconds))

const renderPressable = () => {
  const onTap = vi.fn<() => void>()
  const onLongPress = vi.fn<() => void>()

  render(
    <Pressable onTap={onTap} onLongPress={onLongPress}>
      Review WatchHerd snapshot diff
    </Pressable>,
  )

  return { onTap, onLongPress, button: screen.getByRole('button') }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Pressable', () => {
  it('taps', () => {
    const { onTap, onLongPress, button } = renderPressable()

    fireEvent.click(button)

    expect(onTap).toHaveBeenCalledOnce()
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it.effect('long-presses after holding still, and swallows the click that ends it', () =>
    Effect.gen(function* () {
      const { onTap, onLongPress, button } = renderPressable()

      fireEvent.pointerDown(button, { button: 0, clientX: 10, clientY: 10 })
      yield* advance(LONG_PRESS_MS)
      fireEvent.pointerUp(button)
      fireEvent.click(button)

      expect(onLongPress).toHaveBeenCalledOnce()
      expect(onTap).not.toHaveBeenCalled()
    }),
  )

  it.effect('drops the long-press when the finger moves past the slop', () =>
    Effect.gen(function* () {
      const { onLongPress, button } = renderPressable()

      fireEvent.pointerDown(button, { button: 0, clientX: 10, clientY: 10 })
      fireEvent.pointerMove(button, { clientX: 10, clientY: 30 })
      yield* advance(LONG_PRESS_MS)

      expect(onLongPress).not.toHaveBeenCalled()
    }),
  )

  it.effect('drops the long-press when released early', () =>
    Effect.gen(function* () {
      const { onLongPress, button } = renderPressable()

      fireEvent.pointerDown(button, { button: 0, clientX: 10, clientY: 10 })
      yield* advance(LONG_PRESS_MS / 2)
      fireEvent.pointerUp(button)
      yield* advance(LONG_PRESS_MS)

      expect(onLongPress).not.toHaveBeenCalled()
    }),
  )

  it('treats a right-click as a long-press', () => {
    const { onLongPress, button } = renderPressable()

    fireEvent.contextMenu(button)

    expect(onLongPress).toHaveBeenCalledOnce()
  })
})
