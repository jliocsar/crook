import * as Arr from 'effect/Array'
import * as Equivalence from 'effect/Equivalence'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as React from 'react'

import type { PaneId } from '@crook/domain/Ids'
import type { AgentCardModel } from '@crook/web/herd/HerdLayout'

const samePanes = Arr.makeEquivalence(Equivalence.String)

const panesOf = (cards: readonly AgentCardModel[]): readonly PaneId[] =>
  Arr.map(cards, (card) => card.row.pane)

export const holdOrder = (
  held: readonly PaneId[],
  cards: readonly AgentCardModel[],
): readonly AgentCardModel[] => {
  const position = (card: AgentCardModel) =>
    pipe(
      Arr.findFirstIndex(held, (pane) => pane === card.row.pane),
      Option.getOrElse(() => held.length),
    )

  return Arr.sort(cards, Order.mapInput(Order.Number, position))
}

export const useHeldOrder = (
  cards: readonly AgentCardModel[],
  holding: boolean,
): readonly AgentCardModel[] => {
  const [held, setHeld] = React.useState(() => panesOf(cards))

  if (!holding) {
    const panes = panesOf(cards)

    if (!samePanes(panes, held)) {
      setHeld(panes)
    }

    return cards
  }

  return holdOrder(held, cards)
}
