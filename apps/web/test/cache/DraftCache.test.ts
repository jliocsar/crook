import { describe, expect, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'

import { attachmentDigestOf } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import {
  ComposerDraft,
  DraftCache,
  DraftCacheUnavailable,
  DraftHead,
  DraftKey,
  DraftNotSaved,
  type DraftStore,
  type PaneDrafts,
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

const edited = (drafts: PaneDrafts) => ({ edited: drafts, untouched: HashSet.empty<DraftKey>() })

const keysIn = (entries: ReadonlyMap<string, unknown>) => [...entries.keys()].toSorted()

const refusing: DraftStore = {
  keys: Effect.fail(new DraftCacheUnavailable({ cause: 'blocked' })),
  readMany: () => Effect.fail(new DraftCacheUnavailable({ cause: 'blocked' })),
  writeMany: () => Effect.fail(new DraftNotSaved({ cause: 'blocked' })),
  remove: () => Effect.fail(new DraftNotSaved({ cause: 'blocked' })),
}

describe('DraftCache', () => {
  it.effect('loads the words and the attachment ids first, and the bytes only when asked', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { store } = yield* makeMemoryDraftStore()
        const draft = new ComposerDraft({
          text: 'what broke?',
          attachments: [yield* log, yield* shot],
        })

        yield* (yield* cacheOver(store)).save(edited(HashMap.make([FIRST, draft])))

        const reopened = yield* cacheOver(store)
        const heads = yield* reopened.loadHeads
        const head = new DraftHead({ text: 'what broke?', attachments: ['a1', 'a2'] })

        expect(HashMap.get(heads, FIRST)).toEqual(Option.some(head))
        expect(yield* reopened.loadAttachments(FIRST, head)).toEqual(draft.attachments)
      }),
    ),
  )

  it.effect('rewrites only the words when the words change', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { store, written } = yield* makeMemoryDraftStore()
        const cache = yield* cacheOver(store)
        const attachments = [yield* log]

        yield* cache.save(
          edited(HashMap.make([FIRST, new ComposerDraft({ text: 'wh', attachments })])),
        )
        yield* Ref.set(written, [])
        yield* cache.save(
          edited(HashMap.make([FIRST, new ComposerDraft({ text: 'what', attachments })])),
        )

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

        yield* cache.save(edited(HashMap.make([FIRST, both])))
        yield* cache.save(
          edited(
            HashMap.make([FIRST, new ComposerDraft({ text: '', attachments: [yield* shot] })]),
          ),
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
          edited(
            HashMap.make(
              [FIRST, new ComposerDraft({ text: 'gone', attachments: [yield* log] })],
              [SECOND, kept],
            ),
          ),
        )
        yield* cache.save(edited(HashMap.make([SECOND, kept])))

        expect(keysIn(Ref.getUnsafe(entries))).toEqual([SECOND_HEAD_ID])
      }),
    ),
  )

  it.effect('keeps a draft nobody edited without reading or rewriting it', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { store, entries, written } = yield* makeMemoryDraftStore()
        const kept = new ComposerDraft({ text: 'kept', attachments: [yield* shot] })

        yield* (yield* cacheOver(store)).save(edited(HashMap.make([FIRST, kept])))
        yield* Ref.set(written, [])

        const reopened = yield* cacheOver(store)

        yield* reopened.loadHeads
        yield* reopened.save({
          edited: HashMap.make([SECOND, new ComposerDraft({ text: 'new', attachments: [] })]),
          untouched: HashSet.make(FIRST),
        })

        expect(Ref.getUnsafe(written)).toEqual([['draft', LAPTOP, SECOND.pane]])
        expect(keysIn(Ref.getUnsafe(entries))).toEqual([
          FIRST_SHOT_ID,
          FIRST_HEAD_ID,
          SECOND_HEAD_ID,
        ])
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

        const loaded = yield* (yield* cacheOver(store)).loadHeads

        expect(HashMap.size(loaded)).toBe(0)
        expect(Ref.getUnsafe(entries).size).toBe(0)
      }),
    ),
  )

  it.effect('stops rewriting an attachment the device would not store', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { store, written } = yield* makeMemoryDraftStore()
        const full: DraftStore = {
          ...store,
          writeMany: (pairs) =>
            Effect.andThen(
              Ref.update(written, (keys) => [...keys, ...pairs.map(([key]) => key)]),
              Effect.fail(new DraftNotSaved({ cause: 'QuotaExceededError' })),
            ),
        }
        const cache = yield* cacheOver(full)
        const attachments = [yield* shot]

        yield* cache.save(
          edited(HashMap.make([FIRST, new ComposerDraft({ text: 'a', attachments })])),
        )
        yield* cache.save(
          edited(HashMap.make([FIRST, new ComposerDraft({ text: 'ab', attachments })])),
        )

        expect(Ref.getUnsafe(written)).toEqual([
          ['attachment', LAPTOP, FIRST.pane, 'a2'],
          ['draft', LAPTOP, FIRST.pane],
          ['draft', LAPTOP, FIRST.pane],
        ])
      }),
    ),
  )

  it.effect('loads nothing, and saves without failing, when the browser refuses storage', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cache = yield* cacheOver(refusing)

        expect(HashMap.size(yield* cache.loadHeads)).toBe(0)

        yield* cache.save(
          edited(HashMap.make([FIRST, new ComposerDraft({ text: 'hi', attachments: [] })])),
        )
      }),
    ),
  )
})
