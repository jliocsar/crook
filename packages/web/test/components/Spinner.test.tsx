import { describe, expect, it } from '@effect/vitest'
import { cleanup, render } from '@testing-library/react'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { afterEach } from 'vitest'

import { Spinner } from '@crook/web/components/ui/spinner'
import { NOTICE_DELAY, NOTICE_HOLD } from '@crook/web/machine/NoticeTiming'

const SPINNER = '[data-slot="spinner"]'
const IDLE = '[data-testid="idle"]'
const SLOT = '[data-slot="spinner-slot"]'
const MARGIN = Duration.millis(150)
const FADE = Duration.millis(250)

const idleGlyph = <span data-testid="idle" />

const shownIn = (container: HTMLElement): boolean => container.querySelector(SPINNER) !== null

afterEach(() => {
  cleanup()
})

describe('the indicator', () => {
  it.live('shows nothing but what it stands in for until its delay is out', () =>
    Effect.gen(function* () {
      const { container } = render(<Spinner idle={idleGlyph} />)

      expect(shownIn(container)).toBe(false)
      expect(container.querySelector(IDLE)).not.toBeNull()

      yield* Effect.sleep(Duration.subtract(NOTICE_DELAY, MARGIN))

      expect(shownIn(container)).toBe(false)

      yield* Effect.sleep(Duration.times(MARGIN, 2))

      expect(shownIn(container)).toBe(true)
      expect(container.querySelector(IDLE)).toBeNull()
    }),
  )

  it.live('never shows for a wait that ends before its delay, and takes no room meanwhile', () =>
    Effect.gen(function* () {
      const { container, rerender } = render(<Spinner size={14} />)

      expect(container.querySelector(SLOT)).toBeNull()

      rerender(<Spinner pending={false} size={14} />)

      yield* Effect.sleep(Duration.sum(NOTICE_DELAY, MARGIN))

      expect(shownIn(container)).toBe(false)
    }),
  )

  it.live('holds its room while it waits when its host asks', () =>
    Effect.sync(() => {
      const { container, rerender } = render(<Spinner holdsRoom size={14} />)

      expect(container.querySelector<HTMLElement>(SLOT)?.style.width).toBe('14px')

      rerender(<Spinner holdsRoom pending={false} size={14} />)

      expect(container.querySelector(SLOT)).toBeNull()
    }),
  )

  it.live('starts its delay over when a wait ends and another begins inside it', () =>
    Effect.gen(function* () {
      const { container, rerender } = render(<Spinner />)

      yield* Effect.sleep(Duration.subtract(NOTICE_DELAY, Duration.times(MARGIN, 2)))
      rerender(<Spinner pending={false} />)
      rerender(<Spinner />)
      yield* Effect.sleep(Duration.times(MARGIN, 3))

      expect(shownIn(container)).toBe(false)
    }),
  )

  it.live('stays for its minimum after a wait that ends just past the delay', () =>
    Effect.gen(function* () {
      const { container, rerender } = render(<Spinner idle={idleGlyph} />)

      yield* Effect.sleep(Duration.sum(NOTICE_DELAY, MARGIN))

      expect(shownIn(container)).toBe(true)

      rerender(<Spinner pending={false} idle={idleGlyph} />)

      expect(shownIn(container)).toBe(true)

      yield* Effect.sleep(Duration.sum(NOTICE_HOLD, FADE))

      expect(shownIn(container)).toBe(false)
      expect(container.querySelector(IDLE)).not.toBeNull()
    }),
  )
})
