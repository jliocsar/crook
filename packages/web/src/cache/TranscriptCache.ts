import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { createStore, delMany, get, keys, set, type UseStore } from 'idb-keyval'

import { findMachine, type HerdView } from '@crook/domain/HerdView'
import { ClaudeSessionId, MachineId } from '@crook/domain/Ids'
import { agentsIn } from '@crook/domain/MachineState'
import { Subagent } from '@crook/domain/Subagent'
import { TranscriptPosition, type TranscriptSource } from '@crook/domain/Transcript'
import { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import { TranscriptLine, TranscriptView } from '@crook/web/chat/TranscriptState'
import { PageSignals } from '@crook/web/rpc/PageSignals'

export interface TranscriptStore {
  readonly keys: Effect.Effect<readonly unknown[], TranscriptCacheUnavailable>
  readonly read: (key: StoredKey) => Effect.Effect<unknown, TranscriptCacheUnavailable>
  readonly write: (
    key: StoredKey,
    stored: Schema.Json,
  ) => Effect.Effect<void, TranscriptCacheUnavailable>
  readonly remove: (stale: readonly StoredKey[]) => Effect.Effect<void, TranscriptCacheUnavailable>
}

interface Remembered {
  readonly machine: MachineId
  readonly source: TranscriptSource
  readonly view: TranscriptView
  readonly unsaved: boolean
}

type Memory = HashMap.HashMap<string, Remembered>

const TRANSCRIPT_DATABASE = 'crook-transcripts'
const TRANSCRIPT_TABLE = 'transcripts'
const PANE_KIND = 'pane'
const SUBAGENT_KIND = 'subagent'

export const StoredKey = Schema.Tuple([MachineId, Schema.String, Schema.String, ClaudeSessionId])
export type StoredKey = typeof StoredKey.Type

const StoredLine = Schema.Union([
  Schema.TaggedStruct('Message', { session: ClaudeSessionId, message: TranscriptMessage }),
  Schema.TaggedStruct('SessionCleared', { session: ClaudeSessionId }),
])

export class StoredTranscript extends Schema.Class<StoredTranscript>('StoredTranscript')({
  position: TranscriptPosition,
  lines: Schema.Array(StoredLine),
  subagents: Schema.Array(Subagent),
}) {}

export class TranscriptCacheUnavailable extends Schema.TaggedError<TranscriptCacheUnavailable>()(
  'TranscriptCacheUnavailable',
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return 'The browser refused crook access to IndexedDB, so chats are not kept on this device and each one loads from the hub after crook restarts. Check that the site may store data (Safari: Settings > Safari > Advanced > Website Data).'
  }
}

const StoredTranscriptJson = Schema.toCodecJson(StoredTranscript)
const decodeStored = Schema.decodeUnknownEffect(StoredTranscriptJson)
const encodeStored = Schema.encodeEffect(StoredTranscriptJson)
const decodeStoredKey = Schema.decodeUnknownOption(StoredKey)

const sourceSlot = (source: TranscriptSource): readonly [string, string] =>
  Match.value(source).pipe(
    Match.tagsExhaustive({
      PaneTranscript: (pane): readonly [string, string] => [PANE_KIND, pane.pane],
      SubagentTranscript: (subagent): readonly [string, string] => [
        SUBAGENT_KIND,
        `${subagent.session}/${subagent.subagent}`,
      ],
    }),
  )

const memoryKey = (machine: MachineId, source: TranscriptSource) =>
  JSON.stringify([machine, ...sourceSlot(source)])

const isSlotOf = (machine: MachineId, source: TranscriptSource) => (key: StoredKey) => {
  const [kind, id] = sourceSlot(source)

  return key[0] === machine && key[1] === kind && key[2] === id
}

const storedKeyOf = (
  machine: MachineId,
  source: TranscriptSource,
  session: ClaudeSessionId,
): StoredKey => [machine, ...sourceSlot(source), session]

const storedOf = (view: TranscriptView): Option.Option<StoredTranscript> =>
  Option.map(
    view.position,
    (position) => new StoredTranscript({ position, lines: view.lines, subagents: view.subagents }),
  )

const lineOf = (stored: typeof StoredLine.Type): TranscriptLine =>
  Match.value(stored).pipe(
    Match.tagsExhaustive({
      Message: (message) =>
        TranscriptLine.Message({ session: message.session, message: message.message }),
      SessionCleared: (cleared) => TranscriptLine.SessionCleared({ session: cleared.session }),
    }),
  )

const viewOf = (stored: StoredTranscript): TranscriptView =>
  new TranscriptView({
    position: Option.some(stored.position),
    lines: Arr.map(stored.lines, lineOf),
    subagents: stored.subagents,
    skills: [],
    catchingUp: false,
    failure: Option.none(),
  })

const isKept = (herd: HerdView, key: StoredKey): boolean =>
  Option.exists(findMachine(herd, key[0]), (entry) =>
    Option.match(entry.state, {
      onNone: () => true,
      onSome: () =>
        Arr.some(agentsIn(entry.state), (row) =>
          Option.exists(row.claudeSession, (session) => session === key[3]),
        ),
    }),
  )

const indexedDbStore = (database: Effect.Effect<UseStore, TranscriptCacheUnavailable>) => {
  const attempt = <Answer>(run: (store: UseStore) => Promise<Answer>) =>
    Effect.flatMap(database, (store) =>
      Effect.tryPromise({
        try: () => run(store),
        catch: (cause) => new TranscriptCacheUnavailable({ cause }),
      }),
    )

  return {
    keys: attempt((store) => keys(store)),
    read: (key: StoredKey) => attempt((store) => get<unknown>([...key], store)),
    write: (key: StoredKey, stored: Schema.Json) =>
      attempt((store) => set([...key], stored, store)),
    remove: (stale: readonly StoredKey[]) =>
      attempt((store) =>
        delMany(
          Arr.map(stale, (key) => [...key]),
          store,
        ),
      ),
  } satisfies TranscriptStore
}

const warnUnavailable = (error: TranscriptCacheUnavailable) => Effect.logWarning(error.message)

const makeOver = (store: TranscriptStore) =>
  Effect.gen(function* () {
    const page = yield* PageSignals
    const memory = yield* Ref.make<Memory>(HashMap.empty())

    const storedKeys = store.keys.pipe(
      Effect.map((found) =>
        pipe(
          found,
          Arr.map((key) => decodeStoredKey(key)),
          Arr.getSomes,
        ),
      ),
    )

    const readStored = Effect.fn('TranscriptCache.readStored')(function* (key: StoredKey) {
      return yield* Effect.flatMap(store.read(key), decodeStored).pipe(
        Effect.map(viewOf),
        Effect.asSome,
        Effect.catchTag('SchemaError', (error) =>
          Effect.logWarning(
            `A chat kept on this device does not match this build of crook, so it loads from the hub instead: ${error.message}`,
          ).pipe(Effect.andThen(store.remove([key])), Effect.as(Option.none<TranscriptView>())),
        ),
      )
    })

    const loadStored = Effect.fn('TranscriptCache.loadStored')(function* (
      machine: MachineId,
      source: TranscriptSource,
    ) {
      const slot = Arr.findFirst(yield* storedKeys, isSlotOf(machine, source))

      return yield* Option.match(slot, {
        onNone: () => Effect.succeedNone,
        onSome: readStored,
      })
    })

    const load = Effect.fn('TranscriptCache.load')(function* (
      machine: MachineId,
      source: TranscriptSource,
    ) {
      const key = memoryKey(machine, source)

      const fromStore = loadStored(machine, source).pipe(
        Effect.catchTag('TranscriptCacheUnavailable', (error) =>
          Effect.as(warnUnavailable(error), Option.none<TranscriptView>()),
        ),
        Effect.tap((stored) =>
          Option.match(stored, {
            onNone: () => Effect.void,
            onSome: (view) =>
              Ref.update(
                memory,
                HashMap.set<string, Remembered>(key, { machine, source, view, unsaved: false }),
              ),
          }),
        ),
      )

      return yield* Option.match(HashMap.get(yield* Ref.get(memory), key), {
        onNone: () => fromStore,
        onSome: (remembered) => Effect.succeedSome(remembered.view),
      })
    })

    const remember = (machine: MachineId, source: TranscriptSource, view: TranscriptView) =>
      Ref.update(
        memory,
        HashMap.set<string, Remembered>(memoryKey(machine, source), {
          machine,
          source,
          view,
          unsaved: true,
        }),
      )

    const write = Effect.fn('TranscriptCache.write')(function* (
      machine: MachineId,
      source: TranscriptSource,
      view: TranscriptView,
    ) {
      yield* Option.match(storedOf(view), {
        onNone: () => Effect.void,
        onSome: (stored) =>
          Effect.gen(function* () {
            const key = storedKeyOf(machine, source, stored.position.session)
            const replaced = Arr.filter(
              yield* storedKeys,
              (found) => isSlotOf(machine, source)(found) && found[3] !== key[3],
            )

            yield* store.write(key, yield* Effect.orDie(encodeStored(stored)))
            yield* Arr.isReadonlyArrayNonEmpty(replaced) ? store.remove(replaced) : Effect.void
          }),
      })
      yield* Ref.update(
        memory,
        HashMap.modify(memoryKey(machine, source), (remembered) => ({
          ...remembered,
          unsaved: remembered.view !== view,
        })),
      )
    })

    const saveUnsaved = Effect.fn('TranscriptCache.saveUnsaved')(function* (
      machine: MachineId,
      source: TranscriptSource,
    ) {
      const remembered = HashMap.get(yield* Ref.get(memory), memoryKey(machine, source))

      yield* pipe(
        remembered,
        Option.filter((found) => found.unsaved),
        Option.match({
          onNone: () => Effect.void,
          onSome: (found) => write(machine, source, found.view),
        }),
      )
    })

    const prune = Effect.fn('TranscriptCache.prune')(function* (herd: HerdView) {
      const stale = Arr.filter(yield* storedKeys, (key) => !isKept(herd, key))

      yield* Arr.isReadonlyArrayNonEmpty(stale) ? store.remove(stale) : Effect.void
    })

    const persist = Effect.fn('TranscriptCache.persist')(
      function* (machine: MachineId, source: TranscriptSource, herd: Option.Option<HerdView>) {
        yield* saveUnsaved(machine, source)
        yield* Option.match(herd, { onNone: () => Effect.void, onSome: prune })
      },
      Effect.catchTag('TranscriptCacheUnavailable', warnUnavailable),
    )

    const saveAllUnsaved = Effect.gen(function* () {
      const unsaved = pipe(
        Arr.fromIterable(HashMap.values(yield* Ref.get(memory))),
        Arr.filter((remembered) => remembered.unsaved),
      )

      yield* Effect.forEach(
        unsaved,
        (remembered) => write(remembered.machine, remembered.source, remembered.view),
        { discard: true },
      )
    }).pipe(
      Effect.catchTag('TranscriptCacheUnavailable', warnUnavailable),
      Effect.withSpan('TranscriptCache.saveAllUnsaved'),
    )

    yield* page.visible.pipe(
      Stream.filter((visible) => !visible),
      Stream.runForEach(() => saveAllUnsaved),
      Effect.forkScoped,
    )

    return TranscriptCache.of({ load, remember, persist })
  })

export class TranscriptCache extends Context.Service<
  TranscriptCache,
  {
    readonly load: (
      machine: MachineId,
      source: TranscriptSource,
    ) => Effect.Effect<Option.Option<TranscriptView>>
    readonly remember: (
      machine: MachineId,
      source: TranscriptSource,
      view: TranscriptView,
    ) => Effect.Effect<void>
    readonly persist: (
      machine: MachineId,
      source: TranscriptSource,
      herd: Option.Option<HerdView>,
    ) => Effect.Effect<void>
  }
>()('@crook/web/TranscriptCache') {
  static readonly layerOver = (store: TranscriptStore) => Layer.effect(this, makeOver(store))

  static readonly layerWithoutBrowser = Layer.effect(
    this,
    Effect.flatMap(
      Effect.cached(
        Effect.try({
          try: () => createStore(TRANSCRIPT_DATABASE, TRANSCRIPT_TABLE),
          catch: (cause) => new TranscriptCacheUnavailable({ cause }),
        }),
      ),
      (database) => makeOver(indexedDbStore(database)),
    ),
  )

  static readonly layer = Layer.provide(this.layerWithoutBrowser, PageSignals.layer)
}
