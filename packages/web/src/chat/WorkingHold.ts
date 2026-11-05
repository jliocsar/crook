import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { TurnDurationBlock } from '@crook/domain/TranscriptMessage'
import type {
  AssistantMessage,
  SystemMessage,
  UserBlock,
  UserMessage,
} from '@crook/domain/TranscriptMessage'
import type { TranscriptLine } from '@crook/web/chat/TranscriptState'

export type HerdrTurn = Data.TaggedEnum<{
  Working: { readonly since: DateTime.Utc }
  Idle: Record<never, never>
  Elsewhere: Record<never, never>
}>

export interface TurnEvidence {
  readonly ends: boolean
  readonly at: Option.Option<DateTime.Utc>
}

export interface WorkingSignals {
  readonly herdr: HerdrTurn
  readonly evidence: Option.Option<TurnEvidence>
}

const TOOL_USE_STOP = 'tool_use'

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

const userBlockEnds = (block: UserBlock): Option.Option<boolean> =>
  Match.value(block).pipe(
    Match.tagsExhaustive({
      Interruption: () => Option.some(true),
      Text: () => Option.some(false),
      Image: () => Option.some(false),
      ToolResult: () => Option.some(false),
      TaskNotification: () => Option.some(false),
      CompactSummary: () => Option.none<boolean>(),
      LocalCommand: () => Option.none<boolean>(),
      LocalCommandOutput: () => Option.none<boolean>(),
      Unrecognized: () => Option.none<boolean>(),
    }),
  )

const userEnds = (message: UserMessage): Option.Option<boolean> =>
  pipe(
    Option.liftPredicate(message, (found) => !found.isMeta),
    Option.map((found) => pipe(found.blocks, Arr.map(userBlockEnds), Arr.getSomes)),
    Option.filter((signs) => signs.length > 0),
    Option.map((signs) => Arr.contains(signs, true)),
  )

const assistantEnds = (message: AssistantMessage): boolean =>
  message.isApiError || Option.exists(message.stopReason, (reason) => reason !== TOOL_USE_STOP)

const closesTurn = (message: SystemMessage): boolean =>
  message.blocks.some(Schema.is(TurnDurationBlock))

const signed = (
  ends: Option.Option<boolean>,
  at: Option.Option<DateTime.Utc>,
): Option.Option<TurnEvidence> => Option.map(ends, (found): TurnEvidence => ({ ends: found, at }))

const turnEvidenceOf = ({ message }: TranscriptLine): Option.Option<TurnEvidence> =>
  Match.value(message).pipe(
    Match.tagsExhaustive({
      User: (user) => signed(userEnds(user), user.timestamp),
      Assistant: (assistant) => signed(Option.some(assistantEnds(assistant)), assistant.timestamp),
      System: (system) =>
        signed(Option.as(Option.liftPredicate(system, closesTurn), true), system.timestamp),
      UnrecognizedEntry: () => Option.none<TurnEvidence>(),
      Malformed: () => Option.none<TurnEvidence>(),
      Omitted: () => Option.none<TurnEvidence>(),
    }),
  )

export const lastTurnEvidence = (lines: readonly TranscriptLine[]): Option.Option<TurnEvidence> =>
  Arr.findLast(lines, turnEvidenceOf)
