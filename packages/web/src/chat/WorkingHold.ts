import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

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

export const NO_HOLD = Option.none<DateTime.Utc>()

export const sameHold = Option.makeEquivalence(DateTime.Equivalence)

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
    Working: ({ since }) => Option.some(since),
    Idle: () =>
      Option.filter(
        heldSince,
        (since) => !endedSince(since, signals.evidence) && stillOpen(signals.evidence),
      ),
    Elsewhere: () => NO_HOLD,
  })

export const holdingSince = (
  heldSince: Option.Option<DateTime.Utc>,
  evidence: Option.Option<TurnEvidence>,
): Option.Option<DateTime.Utc> => Option.filter(heldSince, (since) => !endedSince(since, evidence))
