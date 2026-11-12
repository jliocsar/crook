import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Semaphore from 'effect/Semaphore'
import type * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { get, set } from 'idb-keyval'

import type { MachineId, PaneId } from '@crook/domain/Ids'
import { OpenedTimes, withOpened } from '@crook/domain/OpenedTimes'

export interface OpenedStore {
  readonly read: Effect.Effect<unknown, OpenedTimesUnavailable>
  readonly write: (
    stored: typeof OpenedTimes.Encoded,
  ) => Effect.Effect<void, OpenedTimesUnavailable>
}

export interface ChatOpened {
  readonly machine: MachineId
  readonly pane: PaneId
  readonly listed: Option.Option<readonly PaneId[]>
}

const OPENED_TIMES_KEY = 'crook.opened'

export class OpenedTimesUnavailable extends Schema.TaggedError<OpenedTimesUnavailable>()(
  'OpenedTimesUnavailable',
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return 'The browser refused crook access to IndexedDB, so the agent list cannot remember which chats you opened last on this device. crook still works, and lists them in the order herdr gives. Check that the site may store data (Safari: Settings > Safari > Advanced > Website Data).'
  }
}

const decodeTimes = Schema.decodeUnknownEffect(OpenedTimes)
const encodeTimes = Schema.encodeEffect(OpenedTimes)

const attempt = <Answer>(run: () => Promise<Answer>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new OpenedTimesUnavailable({ cause }) })

const indexedDbStore: OpenedStore = {
  read: attempt(() => get<unknown>(OPENED_TIMES_KEY)),
  write: (stored) => attempt(() => set(OPENED_TIMES_KEY, stored)),
}

const NOTHING_OPENED: OpenedTimes = {}

const loadFrom = (store: OpenedStore) =>
  store.read.pipe(
    Effect.map(Option.fromUndefinedOr),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(NOTHING_OPENED),
        onSome: decodeTimes,
      }),
    ),
    Effect.catchTags({
      OpenedTimesUnavailable: (error) =>
        Effect.as(Effect.logWarning(error.message), NOTHING_OPENED),
      SchemaError: (error) =>
        Effect.as(
          Effect.logWarning(
            `The chats this device remembers opening do not match this build of crook, so the agent list starts over in the order herdr gives: ${error.message}`,
          ),
          NOTHING_OPENED,
        ),
    }),
    Effect.withSpan('OpenedAgents.load'),
  )

const makeOver = (store: OpenedStore) =>
  Effect.gen(function* () {
    const times = yield* SubscriptionRef.make(yield* loadFrom(store))
    const writes = yield* Semaphore.make(1)

    const saveCurrent = writes.withPermit(
      SubscriptionRef.get(times).pipe(
        Effect.flatMap(encodeTimes),
        Effect.orDie,
        Effect.flatMap(store.write),
        Effect.catchTag('OpenedTimesUnavailable', (error) => Effect.logWarning(error.message)),
      ),
    )

    const record = Effect.fn('OpenedAgents.record')(function* (opened: ChatOpened) {
      const at = yield* DateTime.now

      yield* SubscriptionRef.update(times, (current) => withOpened(current, { ...opened, at }))
      yield* saveCurrent
    })

    return OpenedAgents.of({ times: SubscriptionRef.changes(times), record })
  })

export class OpenedAgents extends Context.Service<
  OpenedAgents,
  {
    readonly times: Stream.Stream<OpenedTimes>
    readonly record: (opened: ChatOpened) => Effect.Effect<void>
  }
>()('@crook/web/OpenedAgents') {
  static readonly layerOver = (store: OpenedStore) => Layer.effect(this, makeOver(store))

  static readonly layer = OpenedAgents.layerOver(indexedDbStore)
}
