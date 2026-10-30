import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as React from 'react'

import type { TurnEvidence } from '@crook/web/chat/ChatItems'

export type HerdrTurn = Data.TaggedEnum<{
  Working: { readonly since: DateTime.Utc }
  Idle: Record<never, never>
  Elsewhere: Record<never, never>
}>

export interface WorkingSignals {
  readonly herdr: HerdrTurn
  readonly evidence: Option.Option<TurnEvidence>
}

export const HerdrTurn = Data.taggedEnum<HerdrTurn>()

const NO_HOLD = Option.none<DateTime.Utc>()

const endedSince = (since: DateTime.Utc, evidence: Option.Option<TurnEvidence>): boolean =>
  Option.exists(
    evidence,
    (found) => found.ends && Option.exists(found.at, (at) => DateTime.isGreaterThan(at, since)),
  )

const stillOpen = (evidence: Option.Option<TurnEvidence>): boolean =>
  Option.exists(evidence, (found) => !found.ends)

export const nextWorkingHold = (
  heldSince: Option.Option<DateTime.Utc>,
  signals: WorkingSignals,
): Option.Option<DateTime.Utc> =>
  HerdrTurn.$match(signals.herdr, {
    Working: ({ since }) =>
      Option.exists(heldSince, (held) => DateTime.Equivalence(held, since))
        ? heldSince
        : Option.some(since),
    Idle: () =>
      Option.isNone(heldSince) ||
      Option.exists(
        heldSince,
        (since) => !endedSince(since, signals.evidence) && stillOpen(signals.evidence),
      )
        ? heldSince
        : NO_HOLD,
    Elsewhere: () => NO_HOLD,
  })

export const isHeld = (
  heldSince: Option.Option<DateTime.Utc>,
  evidence: Option.Option<TurnEvidence>,
): boolean => Option.exists(heldSince, (since) => !endedSince(since, evidence))

export const useWorkingHold = (signals: WorkingSignals): boolean => {
  const [heldSince, setHeldSince] = React.useState(NO_HOLD)
  const next = nextWorkingHold(heldSince, signals)

  if (next !== heldSince) {
    setHeldSince(next)
  }

  return isHeld(next, signals.evidence)
}
