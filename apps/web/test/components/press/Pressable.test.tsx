import { describe, expect, it } from '@effect/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, vi } from 'vitest'

import { Pressable } from '@crook/web/components/press/Pressable'
import { LONG_PRESS_MS } from '@crook/web/components/press/PressGesture'

const advance = (milliseconds: number) =>
  Effect.promise(() => vi.advanceTimersByTimeAsync(milliseconds))

const renderPressable = () => {
  const onTap = vi.fn<(opener: HTMLElement) => void>()
  const onLongPress = vi.fn<() => void>()
  const { unmount } = render(
    <Pressable onTap={onTap} onLongPress={onLongPress}>
      Review WatchHerd snapshot diff
    </Pressable>,
  )

  return { onTap, onLongPress, unmount, button: screen.getByRole('button') }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Pressable', () => {
  it('taps, handing over the element it was tapped on', () => {
    const { onTap, onLongPress, button } = renderPressable()

    fireEvent.click(button)

    expect(onTap).toHaveBeenCalledExactlyOnceWith(button)
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

  it.effect('drops the long-press when it unmounts mid-hold', () =>
    Effect.gen(function* () {
      const { onLongPress, unmount, button } = renderPressable()

      fireEvent.pointerDown(button, { button: 0, clientX: 10, clientY: 10 })
      unmount()
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
