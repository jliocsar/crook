import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Equal from 'effect/Equal'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'
import * as Stream from 'effect/Stream'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'

import { findMachine, type HerdView } from '@crook/domain/HerdView'
import { type GlobalPaneId, toGlobalPaneId } from '@crook/domain/Ids'
import { agentsIn } from '@crook/domain/MachineState'
import { hubRuntime, linkStateAtom } from '@crook/web/atoms/Hub'
import {
  ComposerDraft,
  DraftCache,
  type DraftHeads,
  type DraftKey,
  EMPTY_DRAFT,
  isBlankDraft,
  type PaneDrafts,
  type SavedDrafts,
} from '@crook/web/cache/DraftCache'

export interface AnsweredDraft {
  readonly key: DraftKey
  readonly atSend: ComposerDraft
  readonly settle: (draft: ComposerDraft) => ComposerDraft
}

interface HeldDrafts {
  readonly saved: SavedDrafts
  readonly gone: readonly DraftKey[]
}

type Read = <Value>(atom: Atom.Atom<Value>) => Value

const isKept = (herd: HerdView, key: DraftKey): boolean =>
  Option.exists(findMachine(herd, key.machine), (entry) =>
    Option.match(entry.state, {
      onNone: () => true,
      onSome: () => Arr.some(agentsIn(entry.state), (row) => row.pane === key.pane),
    }),
  )

const herdOf = (read: Read): Option.Option<HerdView> =>
  pipe(
    AsyncResult.value(read(linkStateAtom)),
    Option.flatMap((state) => state.herd),
    Option.map((snapshot) => snapshot.view),
  )

const storedHeadsAtom = hubRuntime
  .atom(DraftCache.use((cache) => cache.loadHeads))
  .pipe(Atom.keepAlive)

const loadedHeadsAtom = Atom.make((get): Option.Option<DraftHeads> =>
  AsyncResult.value(get(storedHeadsAtom)),
)

const editedDraftsAtom = Atom.make<PaneDrafts>(HashMap.empty()).pipe(Atom.keepAlive)

const storedAttachmentsAtom = Atom.family((key: DraftKey) =>
  hubRuntime.atom((get) =>
    Effect.gen(function* () {
      const heads = yield* get.result(storedHeadsAtom)
      const cache = yield* DraftCache

      return yield* Option.match(HashMap.get(heads, key), {
        onNone: () => Effect.succeed([]),
        onSome: (head) => cache.loadAttachments(key, head),
      })
    }),
  ),
)

const storedDraftOf = (read: Read, key: DraftKey): Option.Option<ComposerDraft> =>
  Option.flatMap(read(loadedHeadsAtom), (heads) =>
    Option.match(HashMap.get(heads, key), {
      onNone: () => Option.some(EMPTY_DRAFT),
      onSome: (head) =>
        Arr.isReadonlyArrayNonEmpty(head.attachments)
          ? Option.map(
              AsyncResult.value(read(storedAttachmentsAtom(key))),
              (attachments) => new ComposerDraft({ text: head.text, attachments }),
            )
          : Option.some(new ComposerDraft({ text: head.text, attachments: [] })),
    }),
  )

const currentDraftOf = (read: Read, key: DraftKey): Option.Option<ComposerDraft> =>
  Option.orElse(HashMap.get(read(editedDraftsAtom), key), () => storedDraftOf(read, key))

const heldDraftsAtom = Atom.make((get) =>
  Option.map(get(loadedHeadsAtom), (heads): HeldDrafts => {
    const herd = herdOf(get)
    const kept = (key: DraftKey) =>
      Option.match(herd, { onNone: () => true, onSome: (shown) => isKept(shown, key) })
    const edited = get(editedDraftsAtom)

    return {
      saved: {
        edited: HashMap.filter(edited, (_draft, key) => kept(key)),
        untouched: pipe(
          Arr.fromIterable(HashMap.keys(heads)),
          Arr.filter((key) => kept(key) && !HashMap.has(edited, key)),
          HashSet.fromIterable,
        ),
      },
      gone: pipe(
        Arr.fromIterable(HashMap.keys(edited)),
        Arr.filter((key) => !kept(key)),
      ),
    }
  }),
)

const draftWriterAtom = hubRuntime
  .atom((get) =>
    Effect.gen(function* () {
      const cache = yield* DraftCache

      yield* get.stream(heldDraftsAtom).pipe(
        Stream.buffer({ capacity: 1, strategy: 'sliding' }),
        Stream.runForEach(
          Option.match({
            onNone: () => Effect.void,
            onSome: (held) =>
              Effect.andThen(
                cache.save(held.saved),
                Arr.isReadonlyArrayNonEmpty(held.gone)
                  ? Atom.update(editedDraftsAtom, HashMap.removeMany(held.gone))
                  : Effect.void,
              ),
          }),
        ),
      )
    }),
  )
  .pipe(Atom.keepAlive)

export const draftPanesAtom: Atom.Atom<Option.Option<HashSet.HashSet<GlobalPaneId>>> = Atom.make(
  (get) => {
    get.mount(draftWriterAtom)

    return Option.map(get(heldDraftsAtom), ({ saved }) =>
      pipe(
        Arr.fromIterable(
          HashMap.keys(HashMap.filter(saved.edited, (draft) => !isBlankDraft(draft))),
        ),
        Arr.appendAll(saved.untouched),
        Arr.map((key) => toGlobalPaneId(key.machine, key.pane)),
        HashSet.fromIterable,
      ),
    )
  },
).pipe(Atom.withEquality(Equal.equals))

export const draftAtom = Atom.family((key: DraftKey) =>
  Atom.writable(
    (get): Option.Option<ComposerDraft> => {
      get.mount(draftWriterAtom)

      return currentDraftOf(get, key)
    },
    (context, draft: ComposerDraft) => {
      const read: Read = (atom) => context.get(atom)

      if (Option.isSome(currentDraftOf(read, key))) {
        context.set(editedDraftsAtom, HashMap.set(context.get(editedDraftsAtom), key, draft))
      }
    },
  ).pipe(Atom.withEquality(Equal.equals)),
)

export const answeredDraftAtom = Atom.writable(
  (): void => undefined,
  (context, answered: AnsweredDraft) => {
    const edited = context.get(editedDraftsAtom)
    const current = Option.getOrElse(HashMap.get(edited, answered.key), () => answered.atSend)

    context.set(editedDraftsAtom, HashMap.set(edited, answered.key, answered.settle(current)))
  },
)
