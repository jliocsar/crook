import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
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
  ) => Effect.Effect<void, DraftCacheUnavailable>
  readonly remove: (stale: readonly StoredKey[]) => Effect.Effect<void, DraftCacheUnavailable>
}

interface Change {
  readonly writes: readonly (readonly [StoredKey, unknown])[]
  readonly removes: readonly StoredKey[]
}

export type PaneDrafts = HashMap.HashMap<DraftKey, ComposerDraft>

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

export class DraftCacheUnavailable extends Schema.TaggedError<DraftCacheUnavailable>()(
  'DraftCacheUnavailable',
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return 'The browser refused crook access to IndexedDB, so an unsent message is not kept on this device and is lost when crook closes. Check that the site may store data (Safari: Settings > Safari > Advanced > Website Data).'
  }
}

export const EMPTY_DRAFT = new ComposerDraft({ text: '', attachments: [] })

export const isBlankDraft = (draft: ComposerDraft): boolean =>
  draft.text.trim() === '' && draft.attachments.length === 0

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

const storedHeadOf = (draft: ComposerDraft): StoredHead => ({
  text: draft.text,
  attachments: Arr.map(draft.attachments, (attachment) => attachment.id),
})

const attachmentIds = (draft: ComposerDraft): readonly string[] =>
  Arr.map(draft.attachments, (attachment) => attachment.id)

const attachmentsOnlyIn = (
  draft: ComposerDraft,
  other: Option.Option<ComposerDraft>,
): readonly DraftAttachment[] => {
  const others = Option.match(other, {
    onNone: (): readonly string[] => [],
    onSome: attachmentIds,
  })

  return Arr.filter(draft.attachments, (attachment) => !others.includes(attachment.id))
}

const entriesOf = (drafts: PaneDrafts): readonly (readonly [DraftKey, ComposerDraft])[] =>
  Arr.fromIterable(HashMap.entries(drafts))

const keysOfDraft = (key: DraftKey, draft: ComposerDraft): readonly StoredKey[] => [
  headKeyOf(key),
  ...Arr.map(draft.attachments, (attachment) => attachmentKeyOf(key, attachment.id)),
]

const changeOf = (stored: PaneDrafts, desired: PaneDrafts): Change => {
  const dropped = pipe(
    entriesOf(stored),
    Arr.filter(([key]) => !HashMap.has(desired, key)),
    Arr.flatMap(([key, draft]) => keysOfDraft(key, draft)),
  )
  const changed = Arr.filter(entriesOf(desired), ([key, draft]) =>
    Option.match(HashMap.get(stored, key), { onNone: () => true, onSome: (was) => was !== draft }),
  )
  const writes = Arr.flatMap(
    changed,
    ([key, draft]): readonly (readonly [StoredKey, unknown])[] => [
      ...Arr.map(
        attachmentsOnlyIn(draft, HashMap.get(stored, key)),
        (attachment): readonly [StoredKey, unknown] => [
          attachmentKeyOf(key, attachment.id),
          storedAttachmentOf(attachment),
        ],
      ),
      [headKeyOf(key), storedHeadOf(draft)],
    ],
  )
  const unlinked = Arr.flatMap(changed, ([key, draft]) =>
    Option.match(HashMap.get(stored, key), {
      onNone: (): readonly StoredKey[] => [],
      onSome: (was) =>
        Arr.map(attachmentsOnlyIn(was, Option.some(draft)), (attachment) =>
          attachmentKeyOf(key, attachment.id),
        ),
    }),
  )

  return { writes, removes: [...dropped, ...unlinked] }
}

const indexedDbStore = (database: Effect.Effect<UseStore, DraftCacheUnavailable>) => {
  const attempt = <Answer>(run: (store: UseStore) => Promise<Answer>) =>
    Effect.flatMap(database, (store) =>
      Effect.tryPromise({
        try: () => run(store),
        catch: (cause) => new DraftCacheUnavailable({ cause }),
      }),
    )

  return {
    keys: attempt((store) => keys(store)),
    readMany: (wanted: readonly StoredKey[]) =>
      attempt((store) =>
        getMany<unknown>(
          Arr.map(wanted, (key) => [...key]),
          store,
        ),
      ),
    writeMany: (entries: readonly (readonly [StoredKey, unknown])[]) =>
      attempt((store) =>
        setMany(
          Arr.map(entries, ([key, value]): [IDBValidKey, unknown] => [[...key], value]),
          store,
        ),
      ),
    remove: (stale: readonly StoredKey[]) =>
      attempt((store) =>
        delMany(
          Arr.map(stale, (key) => [...key]),
          store,
        ),
      ),
  } satisfies DraftStore
}

const warnUnavailable = (error: DraftCacheUnavailable) => Effect.logWarning(error.message)

const readDrafts = Effect.fn('DraftCache.readDrafts')(function* (store: DraftStore) {
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
  const headValues = yield* store.readMany(heads)
  const attachmentValues = yield* store.readMany(attachmentKeys)
  const attachments = pipe(
    Arr.zipWith(attachmentKeys, attachmentValues, (key, value) =>
      Option.map(decodeAttachment(value), (decoded): readonly [string, DraftAttachment] => [
        JSON.stringify(key),
        draftAttachmentOf(decoded),
      ]),
    ),
    Arr.getSomes,
    HashMap.fromIterable,
  )

  const draftOf = (key: HeadKey, head: StoredHead): readonly [DraftKey, ComposerDraft] => {
    const draftKey = draftKeyOf(key)

    return [
      draftKey,
      new ComposerDraft({
        text: head.text,
        attachments: pipe(
          head.attachments,
          Arr.map((id) => HashMap.get(attachments, JSON.stringify(attachmentKeyOf(draftKey, id)))),
          Arr.getSomes,
        ),
      }),
    ]
  }

  const drafts: PaneDrafts = pipe(
    Arr.zipWith(heads, headValues, (key, value) =>
      Option.map(decodeHead(value), (head) => draftOf(key, head)),
    ),
    Arr.getSomes,
    HashMap.fromIterable,
  )
  const kept = HashMap.filter(drafts, (draft) => !isBlankDraft(draft))
  const keptKeys = pipe(
    entriesOf(kept),
    Arr.flatMap(([key, draft]) => keysOfDraft(key, draft)),
    Arr.map((key) => JSON.stringify(key)),
  )
  const stale = Arr.filter(
    [...heads, ...attachmentKeys],
    (key) => !keptKeys.includes(JSON.stringify(key)),
  )

  yield* Arr.isReadonlyArrayNonEmpty(stale) ? store.remove(stale) : Effect.void

  return kept
})

const makeOver = (store: DraftStore) =>
  Effect.gen(function* () {
    const stored = yield* Ref.make<PaneDrafts>(HashMap.empty())

    const load = readDrafts(store).pipe(
      Effect.tap((drafts) => Ref.set(stored, drafts)),
      Effect.catchTag('DraftCacheUnavailable', (error) =>
        Effect.as(warnUnavailable(error), HashMap.empty<DraftKey, ComposerDraft>()),
      ),
      Effect.withSpan('DraftCache.load'),
    )

    const save = Effect.fn('DraftCache.save')(
      function* (desired: PaneDrafts) {
        const change = changeOf(yield* Ref.get(stored), desired)

        yield* Arr.isReadonlyArrayNonEmpty(change.writes)
          ? store.writeMany(change.writes)
          : Effect.void
        yield* Arr.isReadonlyArrayNonEmpty(change.removes)
          ? store.remove(change.removes)
          : Effect.void
        yield* Ref.set(stored, desired)
      },
      Effect.catchTag('DraftCacheUnavailable', warnUnavailable),
    )

    return DraftCache.of({ load, save })
  })

export class DraftCache extends Context.Service<
  DraftCache,
  {
    readonly load: Effect.Effect<PaneDrafts>
    readonly save: (desired: PaneDrafts) => Effect.Effect<void>
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
