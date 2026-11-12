import { describe, expect, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'

import { attachmentDigestOf } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import {
  ComposerDraft,
  DraftCache,
  DraftCacheUnavailable,
  DraftKey,
  type DraftStore,
} from '@crook/web/cache/DraftCache'
import type { DraftAttachment } from '@crook/web/chat/Attachments'

import { LAPTOP } from '../HerdFixtures.ts'
import { makeMemoryDraftStore } from '../HubFakes.ts'

const FIRST = new DraftKey({ machine: LAPTOP, pane: PaneId.make('w1:p1') })
const SECOND = new DraftKey({ machine: LAPTOP, pane: PaneId.make('w1:p2') })
const LOG_TEXT = 'step 3 failed'
const FIRST_HEAD_ID = JSON.stringify(['draft', LAPTOP, FIRST.pane])
const FIRST_SHOT_ID = JSON.stringify(['attachment', LAPTOP, FIRST.pane, 'a2'])
const SECOND_HEAD_ID = JSON.stringify(['draft', LAPTOP, SECOND.pane])
const SHOT_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const attachmentOf = (id: string, name: string, bytes: Uint8Array<ArrayBuffer>) =>
  Effect.map(attachmentDigestOf(bytes), (digest): DraftAttachment => ({
    id,
    name,
    mediaType: name.endsWith('.png') ? 'image/png' : 'text/plain',
    kind: name.endsWith('.png') ? 'image' : 'file',
    bytes,
    digest,
  }))

const log = attachmentOf('a1', 'build.log', new TextEncoder().encode(LOG_TEXT))
const shot = attachmentOf('a2', 'Screenshot.png', new Uint8Array(SHOT_BYTES))

const cacheOver = Effect.fn('cacheOver')(function* (store: DraftStore) {
  const context = yield* Layer.build(DraftCache.layerOver(store))

  return Context.get(context, DraftCache)
})

const keysIn = (entries: ReadonlyMap<string, unknown>) => [...entries.keys()].toSorted()

const refusing: DraftStore = {
  keys: Effect.fail(new DraftCacheUnavailable({ cause: 'blocked' })),
  readMany: () => Effect.fail(new DraftCacheUnavailable({ cause: 'blocked' })),
  writeMany: () => Effect.fail(new DraftCacheUnavailable({ cause: 'blocked' })),
  remove: () => Effect.fail(new DraftCacheUnavailable({ cause: 'blocked' })),
}

describe('DraftCache', () => {
  it.effect('loads back the text and the attachments it saved, bytes and all', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { store } = yield* makeMemoryDraftStore()
        const draft = new ComposerDraft({
          text: 'what broke?',
          attachments: [yield* log, yield* shot],
        })

        yield* (yield* cacheOver(store)).save(HashMap.make([FIRST, draft]))

        const loaded = yield* (yield* cacheOver(store)).load

        expect(HashMap.get(loaded, FIRST)).toEqual(Option.some(draft))
      }),
    ),
  )

  it.effect('rewrites only the words when the words change', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { store, written } = yield* makeMemoryDraftStore()
        const cache = yield* cacheOver(store)
        const attachments = [yield* log]

        yield* cache.save(HashMap.make([FIRST, new ComposerDraft({ text: 'wh', attachments })]))
        yield* Ref.set(written, [])
        yield* cache.save(HashMap.make([FIRST, new ComposerDraft({ text: 'what', attachments })]))

        expect(Ref.getUnsafe(written)).toEqual([['draft', LAPTOP, FIRST.pane]])
      }),
    ),
  )

  it.effect('deletes an attachment the draft no longer holds', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { store, entries } = yield* makeMemoryDraftStore()
        const cache = yield* cacheOver(store)
        const both = new ComposerDraft({ text: '', attachments: [yield* log, yield* shot] })

        yield* cache.save(HashMap.make([FIRST, both]))
        yield* cache.save(
          HashMap.make([FIRST, new ComposerDraft({ text: '', attachments: [yield* shot] })]),
        )

        expect(keysIn(Ref.getUnsafe(entries))).toEqual([FIRST_SHOT_ID, FIRST_HEAD_ID])
      }),
    ),
  )

  it.effect('deletes every record of a pane that left the drafts', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { store, entries } = yield* makeMemoryDraftStore()
        const cache = yield* cacheOver(store)
        const kept = new ComposerDraft({ text: 'keep me', attachments: [] })

        yield* cache.save(
          HashMap.make(
            [FIRST, new ComposerDraft({ text: 'gone', attachments: [yield* log] })],
            [SECOND, kept],
          ),
        )
        yield* cache.save(HashMap.make([SECOND, kept]))

        expect(keysIn(Ref.getUnsafe(entries))).toEqual([SECOND_HEAD_ID])
      }),
    ),
  )

  it.effect('drops what it cannot read, and attachments no draft lists', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { store, entries } = yield* makeMemoryDraftStore()

        yield* store.writeMany([
          [['draft', LAPTOP, FIRST.pane], { text: 42 }],
          [['attachment', LAPTOP, SECOND.pane, 'a9'], { id: 'a9' }],
          [['draft', LAPTOP, SECOND.pane], { text: '   ', attachments: [] }],
        ])

        const loaded = yield* (yield* cacheOver(store)).load

        expect(HashMap.size(loaded)).toBe(0)
        expect(Ref.getUnsafe(entries).size).toBe(0)
      }),
    ),
  )

  it.effect('loads nothing, and saves without failing, when the browser refuses storage', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cache = yield* cacheOver(refusing)

        expect(HashMap.size(yield* cache.load)).toBe(0)

        yield* cache.save(HashMap.make([FIRST, new ComposerDraft({ text: 'hi', attachments: [] })]))
      }),
    ),
  )
})
