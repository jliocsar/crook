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
  type ComposerDraft,
  DraftCache,
  type DraftKey,
  EMPTY_DRAFT,
  isBlankDraft,
  type PaneDrafts,
} from '@crook/web/cache/DraftCache'

const isKept = (herd: HerdView, key: DraftKey): boolean =>
  Option.exists(findMachine(herd, key.machine), (entry) =>
    Option.match(entry.state, {
      onNone: () => true,
      onSome: () => Arr.some(agentsIn(entry.state), (row) => row.pane === key.pane),
    }),
  )

const herdOf = (get: Atom.AtomContext): Option.Option<HerdView> =>
  pipe(
    AsyncResult.value(get(linkStateAtom)),
    Option.flatMap((state) => state.herd),
    Option.map((snapshot) => snapshot.view),
  )

const storedDraftsAtom = hubRuntime.atom(DraftCache.use((cache) => cache.load)).pipe(Atom.keepAlive)

const editedDraftsAtom = Atom.make<PaneDrafts>(HashMap.empty()).pipe(Atom.keepAlive)

const keptDraftsAtom = Atom.make((get) =>
  Option.map(AsyncResult.value(get(storedDraftsAtom)), (stored) => {
    const herd = herdOf(get)

    return HashMap.filter(
      HashMap.union(stored, get(editedDraftsAtom)),
      (draft, key) =>
        !isBlankDraft(draft) &&
        Option.match(herd, { onNone: () => true, onSome: (shown) => isKept(shown, key) }),
    )
  }),
)

const draftWriterAtom = hubRuntime
  .atom((get) =>
    Effect.gen(function* () {
      const cache = yield* DraftCache

      yield* get
        .stream(keptDraftsAtom)
        .pipe(
          Stream.buffer({ capacity: 1, strategy: 'sliding' }),
          Stream.runForEach(
            Option.match({ onNone: () => Effect.void, onSome: (kept) => cache.save(kept) }),
          ),
        )
    }),
  )
  .pipe(Atom.keepAlive)

export const draftPanesAtom: Atom.Atom<Option.Option<HashSet.HashSet<GlobalPaneId>>> = Atom.make(
  (get) => {
    get.mount(draftWriterAtom)

    return Option.map(get(keptDraftsAtom), (kept) =>
      pipe(
        Arr.fromIterable(HashMap.keys(kept)),
        Arr.map((key) => toGlobalPaneId(key.machine, key.pane)),
        HashSet.fromIterable,
      ),
    )
  },
).pipe(Atom.withEquality(Equal.equals))

export const draftAtom = Atom.family((key: DraftKey) =>
  Atom.writable(
    (get): ComposerDraft => {
      get.mount(draftWriterAtom)

      return pipe(
        HashMap.get(get(editedDraftsAtom), key),
        Option.orElse(() =>
          Option.flatMap(AsyncResult.value(get(storedDraftsAtom)), HashMap.get(key)),
        ),
        Option.getOrElse(() => EMPTY_DRAFT),
      )
    },
    (context, draft: ComposerDraft) => {
      context.set(editedDraftsAtom, HashMap.set(context.get(editedDraftsAtom), key, draft))
    },
  ),
)
