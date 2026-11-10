import { describe, expect, it } from '@effect/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as React from 'react'
import { beforeEach, vi } from 'vitest'

import { SwipeRow, useOpenRow } from '@crook/web/components/swipe/SwipeRow'
import type { OpenRow } from '@crook/web/components/swipe/SwipeRow'

import { drag, dragX, eventually, lift, press } from '../../Dom.ts'
import type { PathPoint } from '../../Dom.ts'
import { stubMediaQueries } from '../../MediaQueries.ts'

const ROWS = ['laptop/w1:p1', 'laptop/w1:p2'] as const
const SCROLL_STEP = 15
const SCROLL_STEPS = 6
const SCROLL_FRAME_MS = 16
const SCROLL_DRIFTS = [0, 2, 4, 6, 8, 10, 11, 12, 13, 14] as const
const SCROLL_DIRECTIONS = [-1, 1] as const

const scrollPath = (drift: number, direction: number): readonly PathPoint[] =>
  Array.from({ length: SCROLL_STEPS + 1 }, (_slot, step) => [
    200 - drift * step,
    200 + direction * SCROLL_STEP * step,
  ])

const SCROLLS = SCROLL_DRIFTS.flatMap((drift) =>
  SCROLL_DIRECTIONS.map((direction) => scrollPath(drift, direction)),
)

const handlers = {
  tap: vi.fn<(id: string, opener: HTMLElement) => void>(),
  pin: vi.fn<(id: string) => void>(),
  rows: vi.fn<(row: OpenRow) => void>(),
}

const actionsOf = (id: string) =>
  screen.getByRole('button', { name: `Pin ${id}`, hidden: true }).parentElement

const cardOf = (id: string) =>
  screen
    .getByRole('button', { name: `Agent ${id}`, hidden: true })
    .closest<HTMLElement>('[data-slot="swipe-card"]')

function List({ initiallyOpen }: { initiallyOpen: string | null }) {
  const row = useOpenRow()

  handlers.rows(row)

  React.useEffect(() => {
    row.setOpenId(initiallyOpen)
  }, [])

  return ROWS.map((id) => (
    <SwipeRow
      key={id}
      id={id}
      row={row}
      actions={[{ label: `Pin ${id}`, icon: null, tone: 'secondary', run: () => handlers.pin(id) }]}
      onTap={(opener) => {
        handlers.tap(id, opener)
      }}
      onLongPress={() => undefined}
    >
      {`Agent ${id}`}
    </SwipeRow>
  ))
}

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.clearAllMocks()
})

describe('SwipeRow', () => {
  it('keeps closed actions out of reach', () => {
    render(<List initiallyOpen={null} />)

    expect(actionsOf('laptop/w1:p1')).toHaveProperty('inert', true)
  })

  it('opens one row at a time and runs an action, then closes', () => {
    render(<List initiallyOpen="laptop/w1:p1" />)

    expect(actionsOf('laptop/w1:p1')).toHaveProperty('inert', false)
    expect(actionsOf('laptop/w1:p2')).toHaveProperty('inert', true)

    fireEvent.click(screen.getByRole('button', { name: 'Pin laptop/w1:p1' }))

    expect(handlers.pin).toHaveBeenCalledWith('laptop/w1:p1')
    expect(handlers.rows.mock.lastCall?.[0].openId).toBeNull()
  })

  it('closes the open row when another card is tapped, and does nothing else', () => {
    render(<List initiallyOpen="laptop/w1:p1" />)
    const other = screen.getByRole('button', { name: 'Agent laptop/w1:p2' })

    fireEvent.pointerDown(other)
    fireEvent.click(other)

    expect(handlers.tap).not.toHaveBeenCalled()
    expect(handlers.rows.mock.lastCall?.[0].holding).toBe(false)
  })

  it('opens the agent when nothing is open, from the card it was tapped on', () => {
    render(<List initiallyOpen={null} />)
    const card = screen.getByRole('button', { name: 'Agent laptop/w1:p2' })

    fireEvent.click(card)

    expect(handlers.tap).toHaveBeenCalledWith('laptop/w1:p2', card)
  })

  it.effect('snaps a closed card back when a short drag is released', () =>
    Effect.gen(function* () {
      render(<List initiallyOpen={null} />)
      const card = cardOf('laptop/w1:p1')

      expect(card).not.toBeNull()

      if (card !== null) {
        yield* dragX(card, [200, 195, 190, 185, 180, 175, 170])
      }

      expect(card).toHaveProperty('style.transform', 'none')
      expect(actionsOf('laptop/w1:p1')).toHaveProperty('inert', true)
    }),
  )

  it.effect('holds an open card open when a nudge is released', () =>
    Effect.gen(function* () {
      render(<List initiallyOpen="laptop/w1:p1" />)
      const card = cardOf('laptop/w1:p1')

      yield* eventually(() => {
        expect(card).toHaveProperty('style.transform', 'translateX(-72px)')
      })

      if (card !== null) {
        yield* dragX(card, [200, 205, 210, 215, 220])
      }

      expect(card).toHaveProperty('style.transform', 'translateX(-72px)')
      expect(actionsOf('laptop/w1:p1')).toHaveProperty('inert', false)
    }),
  )

  it.effect('stays put when a drag starts vertically, however far it then goes sideways', () =>
    Effect.gen(function* () {
      render(<List initiallyOpen={null} />)
      const card = cardOf('laptop/w1:p1')

      expect(card).not.toBeNull()

      if (card !== null) {
        yield* press(card, [
          [200, 200],
          [200, 210],
          [200, 220],
          [190, 220],
          [180, 220],
        ])

        expect(card).toHaveProperty('style.transform', 'none')

        yield* lift(card, [180, 220])
      }

      expect(handlers.rows.mock.lastCall?.[0].openId).toBeNull()
      expect(actionsOf('laptop/w1:p1')).toHaveProperty('inert', true)
    }),
  )

  it.effect(
    'opens no row in twenty quick scrolls that drift left, cancelled as the page takes them',
    () =>
      Effect.gen(function* () {
        render(<List initiallyOpen={null} />)
        const card = cardOf('laptop/w1:p1')
        const moved: string[] = []

        expect(card).not.toBeNull()

        if (card !== null) {
          for (const path of SCROLLS) {
            yield* press(card, path, SCROLL_FRAME_MS)
            moved.push(card.style.transform)
            yield* lift(card, path.at(-1) ?? [0, 0], 'pointercancel')
          }
        }

        expect(SCROLLS).toHaveLength(20)
        expect(moved.filter((transform) => transform !== 'none')).toEqual([])
        expect(handlers.rows.mock.calls.filter(([row]) => row.openId !== null)).toEqual([])
      }),
  )

  it.effect('opens in one motion on a quick swipe left that drifts down', () =>
    Effect.gen(function* () {
      render(<List initiallyOpen={null} />)
      const card = cardOf('laptop/w1:p1')

      if (card !== null) {
        yield* drag(
          card,
          [
            [200, 200],
            [192, 204],
            [180, 211],
            [150, 220],
            [120, 230],
          ],
          { stepMs: SCROLL_FRAME_MS },
        )
      }

      expect(card).toHaveProperty('style.transform', 'translateX(-72px)')
      expect(handlers.rows.mock.lastCall?.[0].openId).toBe('laptop/w1:p1')
    }),
  )

  it.effect('does not tap the card when a swipe opens it', () =>
    Effect.gen(function* () {
      render(<List initiallyOpen={null} />)
      const card = cardOf('laptop/w1:p1')

      if (card !== null) {
        yield* dragX(card, [200, 190, 180, 170, 160, 150])
        fireEvent.click(screen.getByRole('button', { name: 'Agent laptop/w1:p1' }))
      }

      expect(handlers.tap).not.toHaveBeenCalled()
    }),
  )
})
