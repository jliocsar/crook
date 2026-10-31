import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as PubSub from 'effect/PubSub'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import type { SqlError } from 'effect/sql/SqlError'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { type SeenMark, isSameSeenMark, seenMarkOf } from '@crook/domain/AgentRow'
import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdMachine, HerdView, byMachineId } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { Machine, type MachineConnection } from '@crook/domain/Machine'
import { type MachineState, agentsIn } from '@crook/domain/MachineState'
import {
  AGENT_PING_INTERVAL,
  AGENT_SOCKET_OPEN_TIMEOUT,
  type Hello,
  MachineIdMismatch,
} from '@crook/protocol/AgentLink'
import { MachineNotInHerd, MachineStillConnected, PaneNotInHerd } from '@crook/protocol/ClientApi'

import packageJson from '../package.json' with { type: 'json' }

import { logStorageFailure } from '@crook/hub/Database'
import { HerdStore, MachineRecord, PinRecord, SeenRecord } from '@crook/hub/HerdStore'

export interface PublishedMachine {
  readonly machineLabel: string
  readonly previous: Option.Option<MachineState>
  readonly next: MachineState
  readonly seen: HashSet.HashSet<PaneId>
}

export class MachinePublished extends Data.TaggedClass('MachinePublished')<PublishedMachine> {}

export class PaneSeen extends Data.TaggedClass('PaneSeen')<{
  readonly machine: MachineId
  readonly pane: PaneId
}> {}

export class MachineForgotten extends Data.TaggedClass('MachineForgotten')<{
  readonly machine: MachineId
}> {}

export class MachineWentOffline extends Data.TaggedClass('MachineWentOffline')<{
  readonly machine: MachineId
}> {}

export type HerdChange = MachinePublished | PaneSeen | MachineForgotten | MachineWentOffline

interface MachineEntry {
  readonly id: MachineId
  readonly label: string
  readonly attachments: number
  readonly connection: MachineConnection
  readonly connectionChangedAt: DateTime.Utc
  readonly lastSeenAt: DateTime.Utc
  readonly forgotten: boolean
  readonly agentVersion: Option.Option<CrookVersion>
  readonly herdrVersion: Option.Option<string>
  readonly state: Option.Option<MachineState>
  readonly seen: HashMap.HashMap<PaneId, SeenMark>
  readonly pinned: HashSet.HashSet<PaneId>
}

export const RECONNECT_GRACE = Duration.sum(AGENT_SOCKET_OPEN_TIMEOUT, AGENT_PING_INTERVAL)

export const hubVersion = CrookVersion.make(packageJson.version)

const readableVersion = Schema.decodeUnknownOption(CrookVersion)

const panesInState = (entry: MachineEntry, isKept: (pane: PaneId) => boolean) =>
  pipe(
    agentsIn(entry.state),
    Arr.filter((row) => isKept(row.pane)),
    Arr.map((row) => row.pane),
  )

const toHerdMachine = (entry: MachineEntry) =>
  new HerdMachine({
    machine: new Machine({
      id: entry.id,
      label: entry.label,
      connection: entry.connection,
      connectionChangedAt: entry.connectionChangedAt,
      lastSeenAt: entry.lastSeenAt,
      agentVersion: entry.agentVersion,
      herdrVersion: entry.herdrVersion,
    }),
    state: entry.state,
    seen: panesInState(entry, (pane) => HashMap.has(entry.seen, pane)),
    pinned: panesInState(entry, (pane) => HashSet.has(entry.pinned, pane)),
  })

const toView = (entries: HashMap.HashMap<MachineId, MachineEntry>) =>
  new HerdView({
    hubVersion,
    machines: pipe(
      HashMap.toValues(entries),
      Arr.filter((entry) => !entry.forgotten),
      Arr.map(toHerdMachine),
      Arr.sort(byMachineId),
    ),
  })

const toRecord = (entry: MachineEntry) =>
  new MachineRecord({
    id: entry.id,
    label: entry.label,
    lastSeenAt: entry.lastSeenAt,
    forgotten: entry.forgotten,
    agentVersion: entry.agentVersion,
    herdrVersion: entry.herdrVersion,
  })

const fromRecord =
  (seen: readonly SeenRecord[], pins: readonly PinRecord[]) =>
  (record: MachineRecord): MachineEntry => ({
    id: record.id,
    label: record.label,
    attachments: 0,
    connection: 'offline',
    connectionChangedAt: record.lastSeenAt,
    lastSeenAt: record.lastSeenAt,
    forgotten: record.forgotten,
    agentVersion: record.agentVersion,
    herdrVersion: record.herdrVersion,
    state: Option.none(),
    seen: pipe(
      seen,
      Arr.filter((mark) => mark.machine === record.id),
      Arr.map((mark): [PaneId, SeenMark] => [mark.pane, mark]),
      HashMap.fromIterable,
    ),
    pinned: pipe(
      pins,
      Arr.filter((pin) => pin.machine === record.id),
      Arr.map((pin) => pin.pane),
      HashSet.fromIterable,
    ),
  })

const firstSighting = (id: MachineId, now: DateTime.Utc): MachineEntry => ({
  id,
  label: id,
  attachments: 0,
  connection: 'offline',
  connectionChangedAt: now,
  lastSeenAt: now,
  forgotten: false,
  agentVersion: Option.none(),
  herdrVersion: Option.none(),
  state: Option.none(),
  seen: HashMap.empty(),
  pinned: HashSet.empty(),
})

const attached =
  (hello: Hello) =>
  (entry: MachineEntry, now: DateTime.Utc): MachineEntry => ({
    ...entry,
    label: Option.getOrElse(hello.label, () => entry.id),
    attachments: entry.attachments + 1,
    connection: 'online',
    connectionChangedAt: entry.connection === 'online' ? entry.connectionChangedAt : now,
    lastSeenAt: now,
    forgotten: false,
    agentVersion: readableVersion(hello.agentVersion),
  })

const detached = (entry: MachineEntry, now: DateTime.Utc): MachineEntry =>
  entry.attachments > 1
    ? { ...entry, attachments: entry.attachments - 1, lastSeenAt: now }
    : {
        ...entry,
        attachments: 0,
        connection: 'reconnecting',
        connectionChangedAt: now,
        lastSeenAt: now,
      }

const published = (state: MachineState) => {
  const currentMarks = HashMap.fromIterable(
    Arr.map(state.agents, (row): [PaneId, SeenMark] => [row.pane, seenMarkOf(row)]),
  )

  return (entry: MachineEntry, now: DateTime.Utc): MachineEntry => ({
    ...entry,
    lastSeenAt: now,
    herdrVersion: Option.some(state.herdrVersion),
    state: Option.some(state),
    seen: HashMap.filter(entry.seen, (mark, pane) =>
      Option.exists(HashMap.get(currentMarks, pane), (current) => isSameSeenMark(mark, current)),
    ),
  })
}

const stillDroppedSince = (droppedAt: DateTime.Utc) => (entry: MachineEntry) =>
  entry.connection === 'reconnecting' && DateTime.Equivalence(entry.connectionChangedAt, droppedAt)

const droppedSeenPanes = (previous: MachineEntry, next: MachineEntry) =>
  pipe(
    HashMap.keys(previous.seen),
    Arr.fromIterable,
    Arr.filter((pane) => !HashMap.has(next.seen, pane)),
  )

const logSeenDropFailure = (id: MachineId) => (error: SqlError) =>
  Effect.logError(
    `The hub could not delete the outdated seen marks of machine ${id} from its database, so it drops them in memory only and loads them again on restart: ${error.message}. Check the disk and the file at CROOK_HUB_DATABASE_PATH.`,
  )

const make = Effect.gen(function* () {
  const store = yield* HerdStore
  const scope = yield* Effect.scope
  const changes = yield* PubSub.unbounded<HerdChange>()
  const records = yield* store.machines
  const marks = yield* store.seenMarks
  const pins = yield* store.pins
  const entries = yield* SubscriptionRef.make(
    HashMap.fromIterable(
      Arr.map(records, (record): [MachineId, MachineEntry] => [
        record.id,
        fromRecord(marks, pins)(record),
      ]),
    ),
  )

  const change = <Failure>(
    id: MachineId,
    decide: (
      entry: Option.Option<MachineEntry>,
      now: DateTime.Utc,
    ) => Effect.Effect<Option.Option<MachineEntry>, Failure>,
  ) =>
    SubscriptionRef.updateSomeAndGetEffect(entries, (current) =>
      DateTime.now.pipe(
        Effect.flatMap((now) => decide(HashMap.get(current, id), now)),
        Effect.map(Option.map((next) => HashMap.set(current, id, next))),
      ),
    )

  const changeFromLink = (
    id: MachineId,
    update: (entry: MachineEntry, now: DateTime.Utc) => MachineEntry,
    afterwards: (previous: MachineEntry, next: MachineEntry) => Effect.Effect<void> = () =>
      Effect.void,
  ) =>
    change(id, (entry, now) => {
      const previous = Option.getOrElse(entry, () => firstSighting(id, now))
      const next = update(previous, now)

      return store
        .saveMachine(toRecord(next))
        .pipe(
          Effect.catchTag('SqlError', logStorageFailure(`machine ${id}`)),
          Effect.andThen(afterwards(previous, next)),
          Effect.as(Option.some(next)),
        )
    })

  const visible = (id: MachineId, entry: Option.Option<MachineEntry>) =>
    entry.pipe(
      Option.filter((found) => !found.forgotten),
      Effect.fromOption,
      Effect.mapError(() => new MachineNotInHerd({ machine: id })),
    )

  const agentIn = (id: MachineId, found: MachineEntry, pane: PaneId) =>
    Arr.findFirst(agentsIn(found.state), (agent) => agent.pane === pane).pipe(
      Effect.fromOption,
      Effect.mapError(() => new PaneNotInHerd({ machine: id, pane })),
    )

  const visibleNow = (id: MachineId) =>
    Effect.flatMap(SubscriptionRef.get(entries), (current) => visible(id, HashMap.get(current, id)))

  const expireAfterGrace = (id: MachineId, entry: MachineEntry) =>
    entry.connection === 'reconnecting'
      ? Effect.sleep(RECONNECT_GRACE).pipe(
          Effect.andThen(
            change(id, (current) =>
              current.pipe(
                Option.filter(stillDroppedSince(entry.connectionChangedAt)),
                Option.match({
                  onNone: () => Effect.succeedNone,
                  onSome: (dropped) =>
                    PubSub.publish(changes, new MachineWentOffline({ machine: id })).pipe(
                      Effect.as(Option.some<MachineEntry>({ ...dropped, connection: 'offline' })),
                    ),
                }),
              ),
            ),
          ),
          Effect.forkIn(scope),
        )
      : Effect.void

  const hold = Effect.fn('Herd.hold')(function* (id: MachineId, hello: Hello) {
    return yield* Effect.acquireUseRelease(
      changeFromLink(id, attached(hello)),
      () => Effect.never,
      () =>
        changeFromLink(id, detached).pipe(
          Effect.map(HashMap.get(id)),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: (entry) => expireAfterGrace(id, entry),
            }),
          ),
        ),
    )
  })

  const publish = Effect.fn('Herd.publish')(function* (id: MachineId, state: MachineState) {
    if (state.machine !== id) {
      return yield* new MachineIdMismatch({ connectedMachine: id, publishedMachine: state.machine })
    }

    return yield* changeFromLink(id, published(state), (previous, next) =>
      Arr.match(droppedSeenPanes(previous, next), {
        onEmpty: () => Effect.void,
        onNonEmpty: (panes) =>
          store.dropSeenPanes(id, panes).pipe(Effect.catchTag('SqlError', logSeenDropFailure(id))),
      }).pipe(
        Effect.andThen(
          PubSub.publish(
            changes,
            new MachinePublished({
              machineLabel: next.label,
              previous: previous.state,
              next: state,
              seen: HashSet.fromIterable(HashMap.keys(next.seen)),
            }),
          ),
        ),
      ),
    )
  })

  const forget = Effect.fn('Herd.forget')(function* (id: MachineId) {
    yield* change(id, (entry) =>
      Effect.gen(function* () {
        const found = yield* visible(id, entry)

        if (found.connection !== 'offline') {
          return yield* new MachineStillConnected({ machine: id, connection: found.connection })
        }

        const next: MachineEntry = { ...found, forgotten: true }

        yield* store.saveMachine(toRecord(next))
        yield* PubSub.publish(changes, new MachineForgotten({ machine: id }))

        return Option.some(next)
      }),
    )
  })

  const markSeen = Effect.fn('Herd.markSeen')(function* (id: MachineId, pane: PaneId) {
    yield* change(id, (entry) =>
      Effect.gen(function* () {
        const found = yield* visible(id, entry)
        const row = yield* agentIn(id, found, pane)

        if (HashMap.has(found.seen, pane)) {
          return Option.none()
        }

        const mark = seenMarkOf(row)

        yield* store.markSeen(new SeenRecord({ machine: id, pane, ...mark }))
        yield* PubSub.publish(changes, new PaneSeen({ machine: id, pane }))

        return Option.some({ ...found, seen: HashMap.set(found.seen, pane, mark) })
      }),
    )
  })

  const setPinned = Effect.fn('Herd.setPinned')(function* (
    id: MachineId,
    pane: PaneId,
    pinned: boolean,
  ) {
    yield* change(id, (entry) =>
      Effect.gen(function* () {
        const found = yield* visible(id, entry)

        if (HashSet.has(found.pinned, pane) === pinned) {
          return Option.none()
        }

        const record = new PinRecord({ machine: id, pane })

        if (!pinned) {
          yield* store.unpin(record)

          return Option.some({ ...found, pinned: HashSet.remove(found.pinned, pane) })
        }

        yield* agentIn(id, found, pane)
        yield* store.pin(record)

        return Option.some({ ...found, pinned: HashSet.add(found.pinned, pane) })
      }),
    )
  })

  const requireMachine = Effect.fn('Herd.requireMachine')(function* (id: MachineId) {
    yield* visibleNow(id)
  })

  const requirePane = Effect.fn('Herd.requirePane')(function* (id: MachineId, pane: PaneId) {
    yield* agentIn(id, yield* visibleNow(id), pane)
  })

  return Herd.of({
    hold,
    publish,
    forget,
    markSeen,
    setPinned,
    requireMachine,
    requirePane,
    subscribeChanges: Effect.map(PubSub.subscribe(changes), Stream.fromSubscription),
    view: SubscriptionRef.changes(entries).pipe(
      Stream.buffer({ capacity: 1, strategy: 'sliding' }),
      Stream.map(toView),
    ),
  })
})

export class Herd extends Context.Service<
  Herd,
  {
    readonly hold: (id: MachineId, hello: Hello) => Effect.Effect<never>
    readonly publish: (id: MachineId, state: MachineState) => Effect.Effect<void, MachineIdMismatch>
    readonly forget: (
      id: MachineId,
    ) => Effect.Effect<void, MachineNotInHerd | MachineStillConnected | SqlError>
    readonly markSeen: (
      id: MachineId,
      pane: PaneId,
    ) => Effect.Effect<void, MachineNotInHerd | PaneNotInHerd | SqlError>
    readonly setPinned: (
      id: MachineId,
      pane: PaneId,
      pinned: boolean,
    ) => Effect.Effect<void, MachineNotInHerd | PaneNotInHerd | SqlError>
    readonly requireMachine: (id: MachineId) => Effect.Effect<void, MachineNotInHerd>
    readonly requirePane: (
      id: MachineId,
      pane: PaneId,
    ) => Effect.Effect<void, MachineNotInHerd | PaneNotInHerd>
    readonly subscribeChanges: Effect.Effect<Stream.Stream<HerdChange>, never, Scope.Scope>
    readonly view: Stream.Stream<HerdView>
  }
>()('@crook/hub/Herd') {
  static readonly layer = Layer.effect(this, make)
}
