import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { HerdMachine } from '@crook/domain/HerdView'
import { PaneId } from '@crook/domain/Ids'
import type { ClaudeSessionId } from '@crook/domain/Ids'
import { PaneTranscript, SubagentsChanged, SubagentTranscript } from '@crook/domain/Transcript'
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

describe('TranscriptCache', () => {
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
