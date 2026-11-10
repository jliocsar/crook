import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'

import { PaneId } from '@crook/domain/Ids'
import { cardFor } from '@crook/web/herd/HerdLayout'
import { holdOrder } from '@crook/web/herd/HeldOrder'

import { agent, LAPTOP, machine } from '../HerdFixtures.ts'

const rows = [agent('w1:p1', 'blocked'), agent('w1:p2', 'working'), agent('w1:p3', 'idle')]
const cards = Arr.map(rows, cardFor(machine(LAPTOP, rows)))
const panesOf = (ordered: readonly { readonly row: { readonly pane: PaneId } }[]) =>
  Arr.map(ordered, (card) => card.row.pane)

describe('holdOrder', () => {
  it('keeps the order the cards had when the hold began, whatever the new priority says', () => {
    const reordered = [cards[2], cards[0], cards[1]].filter((card) => card !== undefined)

    expect(panesOf(holdOrder(panesOf(cards), reordered))).toEqual(['w1:p1', 'w1:p2', 'w1:p3'])
  })

  it('puts a card that arrived during the hold after the ones that were there', () => {
    const arrived = cardFor(machine(LAPTOP, rows))(agent('w1:p9', 'blocked'))

    expect(
      panesOf(holdOrder([PaneId.make('w1:p2'), PaneId.make('w1:p1')], [arrived, ...cards])),
    ).toEqual(['w1:p2', 'w1:p1', 'w1:p9', 'w1:p3'])
  })
})
