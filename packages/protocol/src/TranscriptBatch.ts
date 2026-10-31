import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'
import * as TxRef from 'effect/TxRef'

import type { ClaudeSessionId } from '@crook/domain/Ids'
import {
  type BackgroundChanged,
  CHUNK_READ_LIMIT,
  type SkillsChanged,
  type SubagentsChanged,
  type TranscriptCaughtUp,
  TranscriptChunk,
  type TranscriptEvent,
  type TranscriptOpened,
} from '@crook/domain/Transcript'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import {
  type TranscriptUpdate,
  type TranscriptWatchFailed,
  isWatchFailed,
} from '@crook/protocol/Transcripts'

interface SessionUpdates {
  readonly session: ClaudeSessionId
  readonly opened: Option.Option<TranscriptOpened>
  readonly chunks: readonly TranscriptChunk[]
  readonly caughtUp: Option.Option<TranscriptCaughtUp>
  readonly skills: Option.Option<SkillsChanged>
  readonly subagents: Option.Option<SubagentsChanged>
  readonly background: Option.Option<BackgroundChanged>
}

export interface TranscriptBatch {
  readonly sessions: readonly SessionUpdates[]
  readonly failed: Option.Option<TranscriptWatchFailed>
}

export interface TranscriptMailbox {
  readonly offer: (update: TranscriptUpdate) => Effect.Effect<void>
  readonly take: Effect.Effect<Arr.NonEmptyReadonlyArray<TranscriptUpdate>>
  readonly takeCaughtUp: Effect.Effect<Arr.NonEmptyReadonlyArray<TranscriptUpdate>>
  readonly close: Effect.Effect<void>
}

export const EMPTY_BATCH: TranscriptBatch = { sessions: [], failed: Option.none() }

const updatesFor = (session: ClaudeSessionId): SessionUpdates => ({
  session,
  opened: Option.none(),
  chunks: [],
  caughtUp: Option.none(),
  skills: Option.none(),
  subagents: Option.none(),
  background: Option.none(),
})

const joined = (earlier: TranscriptChunk, later: TranscriptChunk) =>
  new TranscriptChunk({
    session: earlier.session,
    offset: earlier.offset,
    nextOffset: later.nextOffset,
    messages: Arr.appendAll(earlier.messages, later.messages),
  })

const withChunk = (chunks: readonly TranscriptChunk[], chunk: TranscriptChunk) =>
  pipe(
    Arr.last(chunks),
    Option.filter((last) => last.nextOffset === chunk.offset),
    Option.match({
      onNone: () => Arr.append(chunks, chunk),
      onSome: (last) => pipe(chunks, Arr.dropRight(1), Arr.append(joined(last, chunk))),
    }),
  )

const intoSession = (
  sessions: readonly SessionUpdates[],
  session: ClaudeSessionId,
  change: (updates: SessionUpdates) => SessionUpdates,
) =>
  pipe(
    Arr.last(sessions),
    Option.filter((last) => last.session === session),
    Option.match({
      onNone: () => Arr.append(sessions, change(updatesFor(session))),
      onSome: (last) => pipe(sessions, Arr.dropRight(1), Arr.append(change(last))),
    }),
  )

const withOpened = (sessions: readonly SessionUpdates[], opened: TranscriptOpened) =>
  Option.exists(
    Arr.last(sessions),
    (last) => last.session === opened.session && Option.isSome(last.opened),
  )
    ? sessions
    : Arr.append(
        sessions,
        Struct.evolve(updatesFor(opened.session), { opened: () => Option.some(opened) }),
      )

const withEvent = (
  sessions: readonly SessionUpdates[],
  event: TranscriptEvent,
): readonly SessionUpdates[] =>
  Match.value(event).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: (opened) => withOpened(sessions, opened),
      TranscriptChunk: (chunk) =>
        intoSession(sessions, chunk.session, (updates) =>
          Struct.evolve(updates, { chunks: (chunks) => withChunk(chunks, chunk) }),
        ),
      TranscriptCaughtUp: (caughtUp) =>
        intoSession(sessions, caughtUp.session, (updates) =>
          Struct.evolve(updates, { caughtUp: () => Option.some(caughtUp) }),
        ),
      SkillsChanged: (changed) =>
        intoSession(sessions, changed.session, (updates) =>
          Struct.evolve(updates, { skills: () => Option.some(changed) }),
        ),
      SubagentsChanged: (changed) =>
        intoSession(sessions, changed.session, (updates) =>
          Struct.evolve(updates, { subagents: () => Option.some(changed) }),
        ),
      BackgroundChanged: (changed) =>
        intoSession(sessions, changed.session, (updates) =>
          Struct.evolve(updates, { background: () => Option.some(changed) }),
        ),
    }),
  )

export const batchWith = (batch: TranscriptBatch, update: TranscriptUpdate): TranscriptBatch =>
  Option.isSome(batch.failed)
    ? batch
    : Match.value(update).pipe(
        Match.tag('TranscriptWatchFailed', (failed) =>
          Struct.evolve(batch, { failed: () => Option.some(failed) }),
        ),
        Match.orElse((event) =>
          Struct.evolve(batch, { sessions: (sessions) => withEvent(sessions, event) }),
        ),
      )

const eventsOf = (updates: SessionUpdates): readonly TranscriptEvent[] => [
  ...Option.toArray(updates.opened),
  ...updates.chunks,
  ...Option.toArray(updates.caughtUp),
  ...Option.toArray(updates.skills),
  ...Option.toArray(updates.subagents),
  ...Option.toArray(updates.background),
]

export const updatesOf = (batch: TranscriptBatch): readonly TranscriptUpdate[] =>
  pipe(batch.sessions, Arr.flatMap(eventsOf), Arr.appendAll(Option.toArray(batch.failed)))

const omittedBytes = (message: TranscriptMessage) =>
  Match.value(message).pipe(
    Match.tag('Omitted', (omitted) => omitted.byteLength),
    Match.orElse(() => 0),
  )

const readBytes = (chunk: TranscriptChunk) =>
  chunk.nextOffset -
  chunk.offset -
  Arr.reduce(chunk.messages, 0, (sum, message) => sum + omittedBytes(message))

const heldBytes = (batch: TranscriptBatch) =>
  Arr.reduce(batch.sessions, 0, (sum, updates) =>
    Arr.reduce(updates.chunks, sum, (total, chunk) => total + readBytes(chunk)),
  )

export const isFull = (batch: TranscriptBatch) => heldBytes(batch) >= CHUNK_READ_LIMIT

const awaitsCatchUp = (batch: TranscriptBatch) =>
  Option.exists(
    Arr.last(batch.sessions),
    (last) => Option.isSome(last.opened) && Option.isNone(last.caughtUp),
  ) && !isFull(batch)

export const isCaughtUp = (batch: TranscriptBatch) =>
  Option.isSome(batch.failed) || !awaitsCatchUp(batch)

const takeWhen = (
  state: TxRef.TxRef<Option.Option<TranscriptBatch>>,
  sendable: (batch: TranscriptBatch) => boolean,
) =>
  Effect.tx(
    Effect.flatMap(TxRef.get(state), (held) =>
      pipe(
        held,
        Option.filter(sendable),
        Option.map(updatesOf),
        Option.filter(Arr.isReadonlyArrayNonEmpty),
        Option.match({
          onNone: () => Effect.txRetry,
          onSome: (updates) => Effect.as(TxRef.set(state, Option.some(EMPTY_BATCH)), updates),
        }),
      ),
    ),
  )

export const makeTranscriptMailbox: Effect.Effect<TranscriptMailbox> = Effect.map(
  TxRef.make(Option.some(EMPTY_BATCH)),
  (state) => ({
    offer: (update) =>
      Effect.tx(
        Effect.flatMap(TxRef.get(state), (held) =>
          Option.exists(held, isFull) && !isWatchFailed(update)
            ? Effect.txRetry
            : TxRef.set(
                state,
                Option.map(held, (batch) => batchWith(batch, update)),
              ),
        ),
      ),
    take: takeWhen(state, () => true),
    takeCaughtUp: takeWhen(state, isCaughtUp),
    close: TxRef.set(state, Option.none()),
  }),
)
