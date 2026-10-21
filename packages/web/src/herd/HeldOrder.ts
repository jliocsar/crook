import * as Arr from 'effect/Array'
import * as Order from 'effect/Order'
import * as React from 'react'

import type { PaneId } from '@crook/domain/Ids'
import type { AgentCardModel } from '@crook/web/herd/HerdLayout'

export const holdOrder = (
  held: readonly PaneId[],
  cards: readonly AgentCardModel[],
): readonly AgentCardModel[] => {
  const position = (card: AgentCardModel) => {
    const index = held.indexOf(card.row.pane)

    return index === -1 ? held.length : index
  }

  return Arr.sort(cards, Order.mapInput(Order.Number, position))
}

export const useHeldOrder = (
  cards: readonly AgentCardModel[],
  holding: boolean,
): readonly AgentCardModel[] => {
  const held = React.useRef<readonly PaneId[]>([])

  if (!holding) {
    held.current = Arr.map(cards, (card) => card.row.pane)

    return cards
  }

  return holdOrder(held.current, cards)
}
