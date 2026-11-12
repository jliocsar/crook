import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Equivalence from 'effect/Equivalence'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import { createStore, delMany, getMany, keys, setMany, type UseStore } from 'idb-keyval'

import { AttachmentDigest } from '@crook/domain/Command'
import { MachineId, PaneId } from '@crook/domain/Ids'
import type { DraftAttachment } from '@crook/web/chat/Attachments'

export interface DraftStore {
  readonly keys: Effect.Effect<readonly unknown[], DraftCacheUnavailable>
  readonly readMany: (
    keys: readonly StoredKey[],
  ) => Effect.Effect<readonly unknown[], DraftCacheUnavailable>
  readonly writeMany: (
    entries: readonly (readonly [StoredKey, unknown])[],
  ) => Effect.Effect<void, DraftNotSaved>
  readonly remove: (stale: readonly StoredKey[]) => Effect.Effect<void, DraftNotSaved>
}

export interface SavedDrafts {
  readonly edited: PaneDrafts
  readonly untouched: HashSet.HashSet<DraftKey>
}

interface Change {
  readonly writes: readonly (readonly [StoredKey, unknown])[]
  readonly removes: readonly StoredKey[]
  readonly next: DraftHeads
}

export type PaneDrafts = HashMap.HashMap<DraftKey, ComposerDraft>

export type DraftHeads = HashMap.HashMap<DraftKey, DraftHead>

export type StoredKey = HeadKey | AttachmentKey

const DRAFT_DATABASE = 'crook-drafts'
const DRAFT_TABLE = 'drafts'
const HEAD_KIND = 'draft'
const ATTACHMENT_KIND = 'attachment'

export const HeadKey = Schema.Tuple([Schema.Literal(HEAD_KIND), MachineId, PaneId])
export type HeadKey = typeof HeadKey.Type

export const AttachmentKey = Schema.Tuple([
  Schema.Literal(ATTACHMENT_KIND),
  MachineId,
  PaneId,
  Schema.String,
])
export type AttachmentKey = typeof AttachmentKey.Type

export const StoredHead = Schema.Struct({
  text: Schema.String,
  attachments: Schema.Array(Schema.String),
})
export type StoredHead = typeof StoredHead.Type

export const StoredAttachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mediaType: Schema.String,
  kind: Schema.Literals(['image', 'file']),
  bytes: Schema.instanceOf(ArrayBuffer),
  digest: AttachmentDigest,
})
export type StoredAttachment = typeof StoredAttachment.Type

export class DraftKey extends Data.Class<{
  readonly machine: MachineId
  readonly pane: PaneId
}> {}

export class ComposerDraft extends Data.Class<{
  readonly text: string
  readonly attachments: readonly DraftAttachment[]
}> {}

export class DraftHead extends Data.Class<{
  readonly text: string
  readonly attachments: readonly string[]
}> {}

export class DraftCacheUnavailable extends Schema.TaggedError<DraftCacheUnavailable>()(
  'DraftCacheUnavailable',
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return 'The browser refused crook access to IndexedDB, so an unsent message is not kept on this device and is lost when crook closes. Check that the site may store data (Safari: Settings > Safari > Advanced > Website Data).'
  }
}

export class DraftNotSaved extends Schema.TaggedError<DraftNotSaved>()('DraftNotSaved', {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return 'crook could not save an unsent message on this device, so it is lost if crook closes. The device may be out of storage: free some space, or remove a large attachment. Typing and sending still work.'
  }
}

export const EMPTY_DRAFT = new ComposerDraft({ text: '', attachments: [] })

export const isBlankDraft = (draft: ComposerDraft): boolean =>
  draft.text.trim() === '' && draft.attachments.length === 0

const sameIds = Arr.makeEquivalence(Equivalence.String)
const decodeHeadKey = Schema.decodeUnknownOption(HeadKey)
const decodeAttachmentKey = Schema.decodeUnknownOption(AttachmentKey)
const decodeHead = Schema.decodeUnknownOption(StoredHead)
const decodeAttachment = Schema.decodeUnknownOption(StoredAttachment)

const headKeyOf = (key: DraftKey): HeadKey => [HEAD_KIND, key.machine, key.pane]

const attachmentKeyOf = (key: DraftKey, id: string): AttachmentKey => [
  ATTACHMENT_KIND,
  key.machine,
  key.pane,
  id,
]

const storedKeyId = (key: StoredKey): string => JSON.stringify(key)

const draftKeyOf = (key: HeadKey | AttachmentKey): DraftKey =>
  new DraftKey({ machine: key[1], pane: key[2] })

const ownBuffer = (bytes: Uint8Array<ArrayBuffer>): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

const storedAttachmentOf = (attachment: DraftAttachment): StoredAttachment => ({
  id: attachment.id,
  name: attachment.name,
  mediaType: attachment.mediaType,
  kind: attachment.kind,
  bytes: ownBuffer(attachment.bytes),
  digest: attachment.digest,
})

const draftAttachmentOf = (stored: StoredAttachment): DraftAttachment => ({
  id: stored.id,
  name: stored.name,
  mediaType: stored.mediaType,
  kind: stored.kind,
  bytes: new Uint8Array(stored.bytes),
  digest: stored.digest,
})

export const headOf = (draft: ComposerDraft): DraftHead =>
  new DraftHead({
    text: draft.text,
    attachments: Arr.map(draft.attachments, (attachment) => attachment.id),
  })

export const isBlankHead = (head: DraftHead): boolean =>
  head.text.trim() === '' && head.attachments.length === 0

const sameHead = (self: DraftHead, that: DraftHead): boolean =>
  self.text === that.text && sameIds(self.attachments, that.attachments)

const entriesOf = <Value>(
  drafts: HashMap.HashMap<DraftKey, Value>,
): readonly (readonly [DraftKey, Value])[] => Arr.fromIterable(HashMap.entries(drafts))

const keysOfHead = (key: DraftKey, head: DraftHead): readonly StoredKey[] => [
  headKeyOf(key),
  ...Arr.map(head.attachments, (id) => attachmentKeyOf(key, id)),
]

const changeOf = (stored: DraftHeads, saved: SavedDrafts): Change => {
  const edited = HashMap.filter(saved.edited, (draft) => !isBlankDraft(draft))
  const isKept = (key: DraftKey) => HashMap.has(edited, key) || HashSet.has(saved.untouched, key)
  const storedIds = (key: DraftKey): readonly string[] =>
    Option.match(HashMap.get(stored, key), {
      onNone: () => [],
      onSome: (was) => was.attachments,
    })
  const dropped = pipe(
    entriesOf(stored),
    Arr.filter(([key]) => !isKept(key)),
    Arr.flatMap(([key, head]) => keysOfHead(key, head)),
  )
  const changed = pipe(
    entriesOf(edited),
    Arr.filter(([key, draft]) =>
      Option.match(HashMap.get(stored, key), {
        onNone: () => true,
        onSome: (was) => !sameHead(was, headOf(draft)),
      }),
    ),
  )
  const writes = Arr.flatMap(
    changed,
    ([key, draft]): readonly (readonly [StoredKey, unknown])[] => [
      ...pipe(
        draft.attachments,
        Arr.filter((attachment) => !storedIds(key).includes(attachment.id)),
        Arr.map((attachment): readonly [StoredKey, unknown] => [
          attachmentKeyOf(key, attachment.id),
          storedAttachmentOf(attachment),
        ]),
      ),
      [headKeyOf(key), { text: draft.text, attachments: headOf(draft).attachments }],
    ],
  )
  const unlinked = Arr.flatMap(changed, ([key, draft]) =>
    pipe(
      storedIds(key),
      Arr.filter((id) => !headOf(draft).attachments.includes(id)),
      Arr.map((id) => attachmentKeyOf(key, id)),
    ),
  )
  const next = HashMap.union(
    HashMap.filter(stored, (_head, key) => HashSet.has(saved.untouched, key)),
    HashMap.map(edited, headOf),
  )

  return { writes, removes: [...dropped, ...unlinked], next }
}

const indexedDbStore = (database: Effect.Effect<UseStore, DraftCacheUnavailable>) => {
  const reading = <Answer>(run: (store: UseStore) => Promise<Answer>) =>
    Effect.flatMap(database, (store) =>
      Effect.tryPromise({
        try: () => run(store),
        catch: (cause) => new DraftCacheUnavailable({ cause }),
      }),
    )
  const writing = <Answer>(run: (store: UseStore) => Promise<Answer>) =>
    database.pipe(
      Effect.mapError((error) => new DraftNotSaved({ cause: error })),
      Effect.flatMap((store) =>
        Effect.tryPromise({
          try: () => run(store),
          catch: (cause) => new DraftNotSaved({ cause }),
        }),
      ),
    )

  return {
    keys: reading((store) => keys(store)),
    readMany: (wanted: readonly StoredKey[]) =>
      reading((store) =>
        getMany<unknown>(
          Arr.map(wanted, (key) => [...key]),
          store,
        ),
      ),
    writeMany: (entries: readonly (readonly [StoredKey, unknown])[]) =>
      writing((store) =>
        setMany(
          Arr.map(entries, ([key, value]): [IDBValidKey, unknown] => [[...key], value]),
          store,
        ),
      ),
    remove: (stale: readonly StoredKey[]) =>
      writing((store) =>
        delMany(
          Arr.map(stale, (key) => [...key]),
          store,
        ),
      ),
  } satisfies DraftStore
}

const warn = (error: DraftCacheUnavailable | DraftNotSaved) => Effect.logWarning(error.message)

const readHeads = Effect.fn('DraftCache.readHeads')(function* (store: DraftStore) {
  const found = yield* store.keys
  const heads = pipe(
    found,
    Arr.map((key) => decodeHeadKey(key)),
    Arr.getSomes,
  )
  const attachmentKeys = pipe(
    found,
    Arr.map((key) => decodeAttachmentKey(key)),
    Arr.getSomes,
  )
  const present = HashSet.fromIterable(Arr.map(attachmentKeys, storedKeyId))
  const headValues = yield* store.readMany(heads)

  const headOfStored = (key: HeadKey, stored: StoredHead): readonly [DraftKey, DraftHead] => {
    const draftKey = draftKeyOf(key)

    return [
      draftKey,
      new DraftHead({
        text: stored.text,
        attachments: Arr.filter(stored.attachments, (id) =>
          HashSet.has(present, storedKeyId(attachmentKeyOf(draftKey, id))),
        ),
      }),
    ]
  }

  const kept: DraftHeads = pipe(
    Arr.zipWith(heads, headValues, (key, value) =>
      Option.map(decodeHead(value), (stored) => headOfStored(key, stored)),
    ),
    Arr.getSomes,
    HashMap.fromIterable,
    HashMap.filter((head) => !isBlankHead(head)),
  )
  const keptKeys = pipe(
    entriesOf(kept),
    Arr.flatMap(([key, head]) => keysOfHead(key, head)),
    Arr.map(storedKeyId),
    HashSet.fromIterable,
  )
  const stale = Arr.filter(
    [...heads, ...attachmentKeys],
    (key) => !HashSet.has(keptKeys, storedKeyId(key)),
  )

  yield* Arr.isReadonlyArrayNonEmpty(stale)
    ? store.remove(stale).pipe(Effect.catchTag('DraftNotSaved', warn))
    : Effect.void

  return kept
})

const readAttachments = Effect.fn('DraftCache.readAttachments')(function* (
  store: DraftStore,
  key: DraftKey,
  head: DraftHead,
) {
  const values = yield* store.readMany(Arr.map(head.attachments, (id) => attachmentKeyOf(key, id)))

  return pipe(
    values,
    Arr.map((value) => Option.map(decodeAttachment(value), draftAttachmentOf)),
    Arr.getSomes,
  )
})

const isAttachmentKey = (key: StoredKey): boolean => key[0] === ATTACHMENT_KIND

const makeOver = (store: DraftStore) =>
  Effect.gen(function* () {
    const stored = yield* Ref.make<DraftHeads>(HashMap.empty())
    const abandoned = yield* Ref.make(HashSet.empty<string>())
    const failing = yield* Ref.make(false)

    const loadHeads = readHeads(store).pipe(
      Effect.tap((heads) => Ref.set(stored, heads)),
      Effect.catchTag('DraftCacheUnavailable', (error) =>
        Effect.as(warn(error), HashMap.empty<DraftKey, DraftHead>()),
      ),
      Effect.withSpan('DraftCache.loadHeads'),
    )

    const loadAttachments = (key: DraftKey, head: DraftHead) =>
      readAttachments(store, key, head).pipe(
        Effect.catchTag('DraftCacheUnavailable', (error) =>
          Effect.as(warn(error), Arr.empty<DraftAttachment>()),
        ),
      )

    const giveUp = (writes: readonly (readonly [StoredKey, unknown])[]) =>
      Ref.update(abandoned, (ids) =>
        pipe(
          writes,
          Arr.map(([key]) => key),
          Arr.filter(isAttachmentKey),
          Arr.map(storedKeyId),
          HashSet.fromIterable,
          HashSet.union(ids),
        ),
      )

    const save = Effect.fn('DraftCache.save')(function* (saved: SavedDrafts) {
      const change = changeOf(yield* Ref.get(stored), saved)
      const given = yield* Ref.get(abandoned)
      const writes = Arr.filter(change.writes, ([key]) => !HashSet.has(given, storedKeyId(key)))
      const written = Effect.gen(function* () {
        yield* Arr.isReadonlyArrayNonEmpty(writes) ? store.writeMany(writes) : Effect.void
        yield* Arr.isReadonlyArrayNonEmpty(change.removes)
          ? store.remove(change.removes)
          : Effect.void
        yield* Ref.set(stored, change.next)
        yield* Ref.set(failing, false)
      })

      yield* written.pipe(
        Effect.catchTag('DraftNotSaved', (error) =>
          Effect.gen(function* () {
            yield* giveUp(writes)

            if (!(yield* Ref.getAndSet(failing, true))) {
              yield* warn(error)
            }
          }),
        ),
      )
    })

    return DraftCache.of({ loadHeads, loadAttachments, save })
  })

export class DraftCache extends Context.Service<
  DraftCache,
  {
    readonly loadHeads: Effect.Effect<DraftHeads>
    readonly loadAttachments: (
      key: DraftKey,
      head: DraftHead,
    ) => Effect.Effect<readonly DraftAttachment[]>
    readonly save: (saved: SavedDrafts) => Effect.Effect<void>
  }
>()('@crook/web/DraftCache') {
  static readonly layerOver = (store: DraftStore) => Layer.effect(this, makeOver(store))

  static readonly layer = Layer.effect(
    this,
    Effect.flatMap(
      Effect.cached(
        Effect.try({
          try: () => createStore(DRAFT_DATABASE, DRAFT_TABLE),
          catch: (cause) => new DraftCacheUnavailable({ cause }),
        }),
      ),
      (database) => makeOver(indexedDbStore(database)),
    ),
  )
}
