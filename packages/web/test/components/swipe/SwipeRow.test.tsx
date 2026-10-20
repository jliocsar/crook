import { describe, expect, it } from '@effect/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, vi } from 'vitest'

import { SwipeRow, useOpenRow } from '@/components/swipe/SwipeRow'
import type { OpenRow } from '@/components/swipe/SwipeRow'

import { stubMediaQueries } from '../../MediaQueries.ts'

const ROWS = ['laptop/w1:p1', 'laptop/w1:p2'] as const

const handlers = {
  tap: vi.fn<(id: string) => void>(),
  pin: vi.fn<(id: string) => void>(),
  rows: vi.fn<(row: OpenRow) => void>(),
}

const actionsOf = (id: string) =>
  screen.getByRole('button', { name: `Pin ${id}`, hidden: true }).parentElement

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
      onTap={() => {
        handlers.tap(id)
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

  it('opens the agent when nothing is open', () => {
    render(<List initiallyOpen={null} />)

    fireEvent.click(screen.getByRole('button', { name: 'Agent laptop/w1:p2' }))

    expect(handlers.tap).toHaveBeenCalledWith('laptop/w1:p2')
  })
})
