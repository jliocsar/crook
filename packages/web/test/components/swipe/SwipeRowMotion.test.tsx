import { describe, expect, it } from '@effect/vitest'
import { render, screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import { beforeEach } from 'vitest'

import { SwipeRow, useOpenRow } from '@crook/web/components/swipe/SwipeRow'

import { afterSpring, dragX } from '../../Dom.ts'
import { stubMediaQueries } from '../../MediaQueries.ts'

const ROW = 'laptop/w1:p1'

const cardOf = () =>
  screen.getByRole('button', { name: `Agent ${ROW}` }).closest('[data-slot="swipe-card"]')

const actions = () => screen.getByRole('button', { name: 'Pin', hidden: true }).parentElement

function List() {
  const row = useOpenRow()

  return (
    <SwipeRow
      id={ROW}
      row={row}
      actions={[{ label: 'Pin', icon: null, tone: 'secondary', run: () => undefined }]}
      onTap={() => undefined}
      onLongPress={() => undefined}
    >
      {`Agent ${ROW}`}
    </SwipeRow>
  )
}

beforeEach(() => {
  stubMediaQueries([])
})

describe('SwipeRow with motion', () => {
  it.effect('glides open when released past half the actions', () =>
    Effect.gen(function* () {
      render(<List />)
      const card = cardOf()

      if (card !== null) {
        yield* dragX(card, [200, 190, 180, 170, 160, 150])
      }

      yield* afterSpring(() => {
        expect(card).toHaveProperty('style.transform', 'translateX(-72px)')
      })

      expect(actions()).toHaveProperty('inert', false)
    }),
  )

  it.effect('glides back closed when released short of half', () =>
    Effect.gen(function* () {
      render(<List />)
      const card = cardOf()

      if (card !== null) {
        yield* dragX(card, [200, 195, 190, 185, 180])
      }

      yield* afterSpring(() => {
        expect(card).toHaveProperty('style.transform', 'none')
      })

      expect(actions()).toHaveProperty('inert', true)
    }),
  )
})
