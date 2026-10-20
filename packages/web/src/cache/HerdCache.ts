import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { get, set } from 'idb-keyval'

import { HerdView } from '@crook/domain/HerdView'

const HERD_SNAPSHOT_KEY = 'crook.herd'

export class HerdSnapshot extends Schema.Class<HerdSnapshot>('HerdSnapshot')({
  view: HerdView,
  syncedAt: Schema.DateTimeUtcFromString,
}) {}

export class HerdCacheUnavailable extends Schema.TaggedError<HerdCacheUnavailable>()(
  'HerdCacheUnavailable',
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return 'The browser refused crook access to IndexedDB, so the herd is not cached on this device. crook still works, but opens blank until the hub answers. Check that the site may store data (Safari: Settings > Safari > Advanced > Website Data).'
  }
}

const decodeSnapshot = Schema.decodeUnknownEffect(HerdSnapshot)
const encodeSnapshot = Schema.encodeEffect(HerdSnapshot)

const readStored = Effect.tryPromise({
  try: () => get<unknown>(HERD_SNAPSHOT_KEY),
  catch: (cause) => new HerdCacheUnavailable({ cause }),
})

const load = readStored.pipe(
  Effect.map(Option.fromUndefinedOr),
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.succeedNone,
      onSome: (stored) => Effect.asSome(decodeSnapshot(stored)),
    }),
  ),
  Effect.catchTags({
    HerdCacheUnavailable: (error) => Effect.as(Effect.logWarning(error.message), Option.none()),
    SchemaError: (error) =>
      Effect.as(
        Effect.logWarning(
          `The cached herd on this device does not match this build of crook, so it is ignored until the hub sends a fresh one: ${error.message}`,
        ),
        Option.none(),
      ),
  }),
  Effect.withSpan('HerdCache.load'),
)

const save = Effect.fn('HerdCache.save')(function* (snapshot: HerdSnapshot) {
  const encoded = yield* pipe(encodeSnapshot(snapshot), Effect.orDie)

  yield* Effect.tryPromise({
    try: () => set(HERD_SNAPSHOT_KEY, encoded),
    catch: (cause) => new HerdCacheUnavailable({ cause }),
  }).pipe(Effect.catchTag('HerdCacheUnavailable', (error) => Effect.logWarning(error.message)))
})

export class HerdCache extends Context.Service<
  HerdCache,
  {
    readonly load: Effect.Effect<Option.Option<HerdSnapshot>>
    readonly save: (snapshot: HerdSnapshot) => Effect.Effect<void>
  }
>()('@crook/web/HerdCache') {
  static readonly layer = Layer.succeed(this, HerdCache.of({ load, save }))
}
