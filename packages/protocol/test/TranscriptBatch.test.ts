import { expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'

import { ClaudeSessionId, SubagentId, TranscriptOffset } from '@crook/domain/Ids'
import { SkillListing } from '@crook/domain/Skill'
import { Subagent } from '@crook/domain/Subagent'
import {
  CHUNK_READ_LIMIT,
  SkillsChanged,
  SubagentsChanged,
  TranscriptCaughtUp,
  TranscriptChunk,
  TranscriptOpened,
  omittedUpTo,
} from '@crook/domain/Transcript'
import { UnrecognizedEntry } from '@crook/domain/TranscriptMessage'
import {
  EMPTY_BATCH,
  batchWith,
  isCaughtUp,
  isFull,
  makeTranscriptMailbox,
  updatesOf,
} from '@crook/protocol/TranscriptBatch'
import {
  TranscriptReadFailed,
  type TranscriptUpdate,
  TranscriptWatchFailed,
} from '@crook/protocol/Transcripts'

const LEFT = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
const CLEARED = ClaudeSessionId.make('5b1e7c2a-8d34-4f6e-9a0b-c7d2e1f3a4b5')

const chunkIn = (session: ClaudeSessionId, offset: number, nextOffset: number) =>
  new TranscriptChunk({
    session,
    offset: TranscriptOffset.make(offset),
    nextOffset: TranscriptOffset.make(nextOffset),
    messages: [
      new UnrecognizedEntry({ offset: TranscriptOffset.make(offset), entryType: 'future' }),
    ],
  })

const caughtUpAt = (session: ClaudeSessionId, offset: number) =>
  new TranscriptCaughtUp({ session, offset: TranscriptOffset.make(offset) })

const rosterOf = (session: ClaudeSessionId, ids: readonly string[]) =>
  new SubagentsChanged({
    session,
    subagents: Arr.map(
      ids,
      (id) =>
        new Subagent({
          id: SubagentId.make(id),
          agentType: 'Explore',
          description: `run ${id}`,
          model: Option.none(),
          toolUseId: Option.none(),
          parent: Option.none(),
          spawnDepth: 0,
          background: true,
          status: 'running',
        }),
    ),
  })

const skillsOf = (session: ClaudeSessionId, count: number) =>
  new SkillsChanged({
    session,
    skills: Arr.makeBy(
      count,
      () =>
        new SkillListing({
          name: 'prototype',
          description: 'Build several versions of a UI piece',
          argumentHint: Option.none(),
          scope: 'project',
        }),
    ),
  })

const describe = (update: TranscriptUpdate) =>
  Match.value(update).pipe(
    Match.tagsExhaustive({
      TranscriptOpened: (opened) => `opened ${opened.session}`,
      TranscriptChunk: (chunk) =>
        `chunk ${chunk.session} ${chunk.offset}-${chunk.nextOffset} ${chunk.messages.length}`,
      SubagentsChanged: (changed) =>
        `subagents ${changed.session} ${changed.subagents.map((subagent) => subagent.id).join(',')}`,
      SkillsChanged: (changed) => `skills ${changed.session} ${changed.skills.length}`,
      TranscriptCaughtUp: (caughtUp) => `caught up ${caughtUp.session} ${caughtUp.offset}`,
      TranscriptWatchFailed: (failed) => `failed ${failed.failure.message}`,
    }),
  )

const batchOf = (updates: readonly TranscriptUpdate[]) =>
  Arr.reduce(updates, EMPTY_BATCH, batchWith)

const described = (updates: readonly TranscriptUpdate[]) =>
  Arr.map(updatesOf(batchOf(updates)), describe)

const failed = new TranscriptWatchFailed({
  failure: new TranscriptReadFailed({ detail: 'permission denied' }),
})

const forkTracked = Effect.fn('forkTracked')(function* <Value>(effect: Effect.Effect<Value>) {
  const done = yield* Ref.make(false)
  const fiber = yield* Effect.forkChild(Effect.tap(effect, () => Ref.set(done, true)))

  return { fiber, done: Effect.andThen(Effect.yieldNow, Ref.get(done)) }
})

it('joins chunks that continue each other and keeps only the latest skills and roster', () => {
  expect(
    described([
      new TranscriptOpened({ session: LEFT }),
      skillsOf(LEFT, 1),
      chunkIn(LEFT, 0, 10),
      rosterOf(LEFT, ['a1']),
      chunkIn(LEFT, 10, 20),
      caughtUpAt(LEFT, 20),
      chunkIn(LEFT, 20, 30),
      skillsOf(LEFT, 2),
      rosterOf(LEFT, ['a1', 'a2']),
    ]),
  ).toEqual([
    `opened ${LEFT}`,
    `chunk ${LEFT} 0-30 3`,
    `caught up ${LEFT} 20`,
    `skills ${LEFT} 2`,
    `subagents ${LEFT} a1,a2`,
  ])
})

it('keeps the final roster of the session a pane left ahead of the session it opened', () => {
  expect(
    described([
      chunkIn(LEFT, 10, 20),
      rosterOf(LEFT, ['a1']),
      new TranscriptOpened({ session: CLEARED }),
      skillsOf(CLEARED, 1),
      chunkIn(CLEARED, 0, 5),
      caughtUpAt(CLEARED, 5),
      rosterOf(CLEARED, []),
    ]),
  ).toEqual([
    `chunk ${LEFT} 10-20 1`,
    `subagents ${LEFT} a1`,
    `opened ${CLEARED}`,
    `chunk ${CLEARED} 0-5 1`,
    `caught up ${CLEARED} 5`,
    `skills ${CLEARED} 1`,
    `subagents ${CLEARED} `,
  ])
})

it('drops an opening of the session it already opened, and keeps chunks with a gap apart', () => {
  expect(
    described([
      new TranscriptOpened({ session: LEFT }),
      chunkIn(LEFT, 0, 10),
      new TranscriptOpened({ session: LEFT }),
      chunkIn(LEFT, 20, 30),
    ]),
  ).toEqual([`opened ${LEFT}`, `chunk ${LEFT} 0-10 1`, `chunk ${LEFT} 20-30 1`])
})

it('ends with a failure and takes nothing after it', () => {
  expect(
    described([new TranscriptOpened({ session: LEFT }), failed, chunkIn(LEFT, 0, 10)]),
  ).toEqual([`opened ${LEFT}`, `failed ${failed.failure.message}`])
})

it('counts the bytes it read toward full, not the ones it left out', () => {
  const omitted = omittedUpTo(LEFT, TranscriptOffset.make(CHUNK_READ_LIMIT * 4))

  expect(isFull(batchOf([omitted]))).toBe(false)
  expect(isFull(batchOf([chunkIn(LEFT, 0, CHUNK_READ_LIMIT - 1)]))).toBe(false)
  expect(isFull(batchOf([chunkIn(LEFT, 0, CHUNK_READ_LIMIT)]))).toBe(true)
})

it('waits on an opening until it caught up, read a full batch or failed', () => {
  const opened = new TranscriptOpened({ session: LEFT })

  expect(isCaughtUp(batchOf([opened]))).toBe(false)
  expect(isCaughtUp(batchOf([opened, chunkIn(LEFT, 0, 10)]))).toBe(false)
  expect(isCaughtUp(batchOf([opened, caughtUpAt(LEFT, 0)]))).toBe(true)
  expect(isCaughtUp(batchOf([opened, chunkIn(LEFT, 0, CHUNK_READ_LIMIT)]))).toBe(true)
  expect(isCaughtUp(batchOf([opened, failed]))).toBe(true)
  expect(isCaughtUp(batchOf([rosterOf(LEFT, []), opened]))).toBe(false)
  expect(isCaughtUp(batchOf([chunkIn(LEFT, 0, 10)]))).toBe(true)
})

it.effect('holds an offer while the mailbox is full, until what it holds is taken', () =>
  Effect.gen(function* () {
    const mailbox = yield* makeTranscriptMailbox

    yield* mailbox.offer(chunkIn(LEFT, 0, CHUNK_READ_LIMIT))
    const blocked = yield* forkTracked(
      mailbox.offer(chunkIn(LEFT, CHUNK_READ_LIMIT, CHUNK_READ_LIMIT + 10)),
    )
    const offeredWhileFull = yield* blocked.done
    const first = yield* mailbox.take

    yield* Fiber.join(blocked.fiber)
    const second = yield* mailbox.take

    expect(offeredWhileFull).toBe(false)
    expect(Arr.map(first, describe)).toEqual([`chunk ${LEFT} 0-${CHUNK_READ_LIMIT} 1`])
    expect(Arr.map(second, describe)).toEqual([
      `chunk ${LEFT} ${CHUNK_READ_LIMIT}-${CHUNK_READ_LIMIT + 10} 1`,
    ])
  }),
)

it.effect('hands an opening over once it caught up, unless asked for whatever it holds', () =>
  Effect.gen(function* () {
    const mailbox = yield* makeTranscriptMailbox
    const opened = new TranscriptOpened({ session: LEFT })

    yield* mailbox.offer(opened)
    const anything = yield* mailbox.take

    yield* mailbox.offer(chunkIn(LEFT, 0, 10))
    yield* mailbox.offer(new TranscriptOpened({ session: CLEARED }))
    const settled = yield* forkTracked(mailbox.takeCaughtUp)
    const takenWhileOpening = yield* settled.done

    yield* mailbox.offer(caughtUpAt(CLEARED, 0))

    expect(Arr.map(anything, describe)).toEqual([`opened ${LEFT}`])
    expect(takenWhileOpening).toBe(false)
    expect(pipe(yield* Fiber.join(settled.fiber), Arr.map(describe))).toEqual([
      `chunk ${LEFT} 0-10 1`,
      `opened ${CLEARED}`,
      `caught up ${CLEARED} 0`,
    ])
  }),
)

it.effect('lets a held offer go once the mailbox is closed', () =>
  Effect.gen(function* () {
    const mailbox = yield* makeTranscriptMailbox

    yield* mailbox.offer(chunkIn(LEFT, 0, CHUNK_READ_LIMIT))
    const blocked = yield* Effect.forkChild(
      mailbox.offer(chunkIn(LEFT, CHUNK_READ_LIMIT, CHUNK_READ_LIMIT + 10)),
    )

    yield* mailbox.close

    expect(yield* Fiber.join(blocked)).toBeUndefined()
  }),
)
