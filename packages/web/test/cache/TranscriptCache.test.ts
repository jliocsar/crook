import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { HerdMachine } from '@crook/domain/HerdView'
import { PaneId, TranscriptOffset } from '@crook/domain/Ids'
import type { ClaudeSessionId } from '@crook/domain/Ids'
import {
  omittedBetween,
  PaneTranscript,
  SubagentsChanged,
  SubagentTranscript,
  TranscriptPosition,
} from '@crook/domain/Transcript'
import { OmittedLines } from '@crook/domain/TranscriptMessage'
import type { TranscriptEvent } from '@crook/domain/Transcript'
import {
  TranscriptCache,
  TranscriptCacheUnavailable,
  type TranscriptStore,
} from '@crook/web/cache/TranscriptCache'
import { applyTranscriptEvent, EMPTY_TRANSCRIPT } from '@crook/web/chat/TranscriptState'
import { PageSignals } from '@crook/web/rpc/PageSignals'

import { agent, herd, LAPTOP, machine } from '../HerdFixtures.ts'
import { makeMemoryTranscriptStore, type StoredEntry } from '../HubFakes.ts'
import {
  caughtUp,
  chunk,
  NEXT_SESSION,
  opened,
  prompt,
  REVIEWER,
  said,
  SESSION,
  subagent,
} from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')

const paneSource = new PaneTranscript({ pane: PANE })

const fold = (events: readonly TranscriptEvent[]) =>
  Arr.reduce(events, EMPTY_TRANSCRIPT, applyTranscriptEvent)

const conversation = fold([
  opened(),
  chunk(0, 20, [prompt(0, 'Review the diff'), said(10, 'Two risks found.')]),
  caughtUp(20),
])

const running = (...sessions: readonly ClaudeSessionId[]) =>
  Option.some(
    herd([
      machine(
        LAPTOP,
        Arr.map(sessions, (session, index) =>
          agent(`w1:p${index + 1}`, 'idle', { claudeSession: session }),
        ),
      ),
    ]),
  )

const cacheOver = Effect.fn('cacheOver')(function* (store: TranscriptStore) {
  const visible = yield* SubscriptionRef.make(true)
  const context = yield* Layer.build(
    Layer.provide(
      TranscriptCache.layerOver(store),
      Layer.succeed(
        PageSignals,
        PageSignals.of({ visible: SubscriptionRef.changes(visible), online: Stream.make(true) }),
      ),
    ),
  )

  return { cache: Context.get(context, TranscriptCache), visible }
})

const storedKeys = (entries: Ref.Ref<ReadonlyMap<string, StoredEntry>>) =>
  Effect.map(Ref.get(entries), (current) => Array.from(current.values(), (entry) => entry.key))

const SavedFields = Schema.Record(Schema.String, Schema.Json)
const SavedLines = Schema.Array(SavedFields)

const rewriteSaved = (
  store: TranscriptStore,
  entries: Ref.Ref<ReadonlyMap<string, StoredEntry>>,
  rewrite: (lines: readonly (typeof SavedFields.Type)[]) => readonly (typeof SavedFields.Type)[],
) =>
  Effect.gen(function* () {
    const [entry] = Array.from((yield* Ref.get(entries)).values())
    const found = yield* Effect.fromNullishOr(entry).pipe(Effect.orDie)
    const saved = yield* Schema.decodeUnknownEffect(SavedFields)(found.stored).pipe(Effect.orDie)
    const lines = yield* Schema.decodeUnknownEffect(SavedLines)(saved['lines']).pipe(Effect.orDie)

    yield* store.write(found.key, { ...saved, lines: rewrite(lines) })
  })

const OMITTED_TAG = 'Omitted'

const gapsOver = (gaps: number) =>
  Arr.makeBy(gaps, (index) => {
    const from = 20 + index * 1000
    const start = from + 990

    return [
      omittedBetween(SESSION, TranscriptOffset.make(from), TranscriptOffset.make(start)),
      chunk(start, start + 10, [said(start, `Tail ${index}`)]),
      caughtUp(start + 10),
    ]
  })

describe('TranscriptCache', () => {
  it.effect('keeps one hole in what it hands back, however many gaps a chat has crossed', () =>
    Effect.gen(function* () {
      const { store } = yield* makeMemoryTranscriptStore()
      const { cache } = yield* cacheOver(store)
      const sizes = yield* Effect.forEach(gapsOver(40), (events) =>
        Effect.gen(function* () {
          const opening = Option.getOrElse(
            yield* cache.load(LAPTOP, paneSource),
            () => conversation,
          )
          const after = Arr.reduce(events, opening, applyTranscriptEvent)

          yield* cache.remember(LAPTOP, paneSource, after)

          return after.lines.length
        }),
      )
      const reopened = Option.getOrThrow(yield* cache.load(LAPTOP, paneSource))

      const settled = Arr.drop(sizes, 3)

      expect(Arr.every(settled, (size) => size <= 6)).toBe(true)
      expect(reopened.lines).toEqual([
        {
          session: SESSION,
          message: new OmittedLines({ offset: TranscriptOffset.make(0), byteLength: 39010 }),
        },
        {
          session: SESSION,
          message: said(39010, 'Tail 38'),
        },
        {
          session: SESSION,
          message: new OmittedLines({ offset: TranscriptOffset.make(39020), byteLength: 990 }),
        },
        { session: SESSION, message: said(40010, 'Tail 39') },
      ])
      expect(reopened.position).toEqual(
        Option.some(
          new TranscriptPosition({ session: SESSION, offset: TranscriptOffset.make(40020) }),
        ),
      )
    }),
  )

  it.effect('saves a hole and reads it back where it was', () =>
    Effect.gen(function* () {
      const { store } = yield* makeMemoryTranscriptStore()
      const { cache } = yield* cacheOver(store)
      const [gap] = gapsOver(1)
      const crossed = Arr.reduce(gap ?? [], conversation, applyTranscriptEvent)

      yield* cache.remember(LAPTOP, paneSource, crossed)
      yield* cache.persist(LAPTOP, paneSource, running(SESSION))

      const { cache: nextRun } = yield* cacheOver(store)
      const restored = Option.getOrThrow(yield* nextRun.load(LAPTOP, paneSource))

      expect(restored.lines).toEqual(crossed.lines)
      expect(restored.position).toEqual(crossed.position)
      expect(
        Arr.filter(restored.lines, ({ message }) =>
          Match.value(message).pipe(
            Match.tag(OMITTED_TAG, () => true),
            Match.orElse(() => false),
          ),
        ),
      ).toHaveLength(1)
    }),
  )

  it.effect('hands a remembered chat back at once, and a saved one to the next app run', () =>
    Effect.gen(function* () {
      const { store, entries } = yield* makeMemoryTranscriptStore()
      const { cache } = yield* cacheOver(store)

      expect(yield* cache.load(LAPTOP, paneSource)).toEqual(Option.none())

      yield* cache.remember(LAPTOP, paneSource, conversation)

      expect(yield* cache.load(LAPTOP, paneSource)).toEqual(Option.some(conversation))
      expect(yield* storedKeys(entries)).toEqual([])

      yield* cache.persist(LAPTOP, paneSource, running(SESSION))
      const nextRun = yield* cacheOver(store)

      expect(yield* storedKeys(entries)).toEqual([[LAPTOP, 'pane', PANE, SESSION]])
      expect(yield* nextRun.cache.load(LAPTOP, paneSource)).toEqual(Option.some(conversation))
    }),
  )

  it.effect('keeps one chat per pane, the one of its latest Claude session', () =>
    Effect.gen(function* () {
      const { store, entries } = yield* makeMemoryTranscriptStore()
      const { cache } = yield* cacheOver(store)
      const cleared = applyTranscriptEvent(conversation, opened(NEXT_SESSION))

      yield* cache.remember(LAPTOP, paneSource, conversation)
      yield* cache.persist(LAPTOP, paneSource, running(SESSION, NEXT_SESSION))
      yield* cache.remember(LAPTOP, paneSource, cleared)
      yield* cache.persist(LAPTOP, paneSource, running(SESSION, NEXT_SESSION))

      expect(yield* storedKeys(entries)).toEqual([[LAPTOP, 'pane', PANE, NEXT_SESSION]])
    }),
  )

  it.effect('drops saved chats of Claude sessions the herd no longer runs', () =>
    Effect.gen(function* () {
      const { store, entries } = yield* makeMemoryTranscriptStore()
      const { cache } = yield* cacheOver(store)
      const subagentSource = new SubagentTranscript({ session: SESSION, subagent: REVIEWER })
      const roster = fold([opened(), caughtUp(0)])
      const otherPane = new PaneTranscript({ pane: PaneId.make('w1:p2') })

      yield* cache.remember(LAPTOP, subagentSource, roster)
      yield* cache.persist(LAPTOP, subagentSource, running(SESSION))
      yield* cache.remember(LAPTOP, otherPane, fold([opened(NEXT_SESSION), caughtUp(0)]))
      yield* cache.persist(LAPTOP, otherPane, running(NEXT_SESSION))

      expect(yield* storedKeys(entries)).toEqual([[LAPTOP, 'pane', 'w1:p2', NEXT_SESSION]])
    }),
  )

  it.effect('keeps the chats of a machine whose state the hub does not know yet', () =>
    Effect.gen(function* () {
      const { store, entries } = yield* makeMemoryTranscriptStore()
      const { cache } = yield* cacheOver(store)
      const unknownState = herd([
        new HerdMachine(Struct.evolve(machine(LAPTOP, []), { state: () => Option.none() })),
      ])

      yield* cache.remember(LAPTOP, paneSource, conversation)
      yield* cache.persist(LAPTOP, paneSource, Option.some(unknownState))

      expect(yield* storedKeys(entries)).toEqual([[LAPTOP, 'pane', PANE, SESSION]])
    }),
  )

  it.effect('saves the chats not yet saved when the page is hidden', () =>
    Effect.gen(function* () {
      const { store, entries } = yield* makeMemoryTranscriptStore()
      const { cache, visible } = yield* cacheOver(store)

      yield* cache.remember(LAPTOP, paneSource, conversation)
      yield* SubscriptionRef.set(visible, false)
      yield* Effect.yieldNow

      expect(yield* storedKeys(entries)).toEqual([[LAPTOP, 'pane', PANE, SESSION]])
    }),
  )

  it.effect('forgets a saved chat this build cannot read', () =>
    Effect.gen(function* () {
      const { store, entries } = yield* makeMemoryTranscriptStore()

      yield* store.write([LAPTOP, 'pane', PANE, SESSION], { lines: 'not a chat' })
      const { cache } = yield* cacheOver(store)

      expect(yield* cache.load(LAPTOP, paneSource)).toEqual(Option.none())
      expect(yield* storedKeys(entries)).toEqual([])
    }),
  )

  it.effect('forgets a chat saved before a thread showed one session, so it reopens cold', () =>
    Effect.gen(function* () {
      const { store, entries } = yield* makeMemoryTranscriptStore()
      const { cache } = yield* cacheOver(store)

      yield* cache.remember(LAPTOP, paneSource, conversation)
      yield* cache.persist(LAPTOP, paneSource, running(SESSION))

      yield* rewriteSaved(store, entries, (lines) =>
        Arr.append(lines, { _tag: 'SessionCleared', session: SESSION }),
      )
      const { cache: nextRun } = yield* cacheOver(store)

      expect(yield* nextRun.load(LAPTOP, paneSource)).toEqual(Option.none())
      expect(yield* storedKeys(entries)).toEqual([])
    }),
  )

  it.effect('still reads a saved chat whose lines carry the old Message tag', () =>
    Effect.gen(function* () {
      const { store, entries } = yield* makeMemoryTranscriptStore()
      const { cache } = yield* cacheOver(store)

      yield* cache.remember(LAPTOP, paneSource, conversation)
      yield* cache.persist(LAPTOP, paneSource, running(SESSION))

      yield* rewriteSaved(store, entries, (lines) =>
        Arr.map(lines, (line) => ({ ...line, _tag: 'Message' })),
      )
      const { cache: nextRun } = yield* cacheOver(store)

      expect(
        Option.map(yield* nextRun.load(LAPTOP, paneSource), (view) => view.lines.length),
      ).toEqual(Option.some(conversation.lines.length))
    }),
  )

  it.effect('works from memory alone when the browser refuses IndexedDB', () =>
    Effect.gen(function* () {
      const refused = Effect.fail(new TranscriptCacheUnavailable({ cause: 'private mode' }))
      const { cache } = yield* cacheOver({
        keys: refused,
        read: () => refused,
        write: () => refused,
        remove: () => refused,
      })

      expect(yield* cache.load(LAPTOP, paneSource)).toEqual(Option.none())

      yield* cache.remember(LAPTOP, paneSource, conversation)
      yield* cache.persist(LAPTOP, paneSource, running(SESSION))

      expect(yield* cache.load(LAPTOP, paneSource)).toEqual(Option.some(conversation))
    }),
  )

  it.effect('keeps a subagent roster as part of a saved chat', () =>
    Effect.gen(function* () {
      const { store } = yield* makeMemoryTranscriptStore()
      const { cache } = yield* cacheOver(store)
      const reviewer = subagent({ toolUseId: 'toolu_1' })
      const withRoster = applyTranscriptEvent(
        conversation,
        new SubagentsChanged({ session: SESSION, subagents: [reviewer] }),
      )

      yield* cache.remember(LAPTOP, paneSource, withRoster)
      yield* cache.persist(LAPTOP, paneSource, running(SESSION))
      const nextRun = yield* cacheOver(store)

      expect(
        Option.flatMap(yield* nextRun.cache.load(LAPTOP, paneSource), (view) =>
          HashMap.get(view.rosters, SESSION),
        ),
      ).toEqual(Option.some([reviewer]))
    }),
  )
})
