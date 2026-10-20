import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'
import type { SqlError } from 'effect/sql/SqlError'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { AgentRow } from '@crook/domain/AgentRow'
import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdMachine, HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { Machine, type MachineConnection } from '@crook/domain/Machine'
import type { MachineState } from '@crook/domain/MachineState'
import { AGENT_PING_INTERVAL, type Hello, MachineIdMismatch } from '@crook/protocol/AgentLink'
import { MachineNotInHerd, MachineStillConnected, PaneNotInHerd } from '@crook/protocol/ClientApi'

import packageJson from '../package.json' with { type: 'json' }

import { MachineRecord, MachineRegistry } from '@crook/hub/MachineRegistry'
import { SeenRecord, SeenTracker } from '@crook/hub/SeenTracker'

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
  readonly seen: HashMap.HashMap<PaneId, number>
}

export const RECONNECT_GRACE = Duration.times(AGENT_PING_INTERVAL, 2)

export const hubVersion = CrookVersion.make(packageJson.version)

const isSameRecord = Schema.toEquivalence(MachineRecord)

const byMachineId = Order.mapInput(Order.String, (entry: MachineEntry) => entry.id)

const agentsOf = (entry: MachineEntry) =>
  Option.match(entry.state, {
    onNone: (): readonly AgentRow[] => [],
    onSome: (state) => state.agents,
  })

const seenPanes = (entry: MachineEntry) =>
  pipe(
    agentsOf(entry),
    Arr.filter((row) => Option.contains(HashMap.get(entry.seen, row.pane), row.stateChangeSeq)),
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
    seen: seenPanes(entry),
  })

const toView = (entries: HashMap.HashMap<MachineId, MachineEntry>) =>
  new HerdView({
    hubVersion,
    machines: pipe(
      HashMap.toValues(entries),
      Arr.filter((entry) => !entry.forgotten),
      Arr.sort(byMachineId),
      Arr.map(toHerdMachine),
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
  (seen: readonly SeenRecord[]) =>
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
      Arr.map((mark): [PaneId, number] => [mark.pane, mark.stateChangeSeq]),
      HashMap.fromIterable,
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
    agentVersion: Option.some(hello.agentVersion),
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
  const livePanes = HashSet.fromIterable(state.agents.map((row) => row.pane))

  return (entry: MachineEntry, now: DateTime.Utc): MachineEntry => ({
    ...entry,
    lastSeenAt: now,
    herdrVersion: Option.some(state.herdrVersion),
    state: Option.some(state),
    seen: HashMap.filter(entry.seen, (_seq, pane) => HashSet.has(livePanes, pane)),
  })
}

const stillDroppedSince = (droppedAt: DateTime.Utc) => (entry: MachineEntry) =>
  entry.attachments === 0 &&
  entry.connection === 'reconnecting' &&
  DateTime.Equivalence(entry.connectionChangedAt, droppedAt)

const forgottenPanes = (previous: MachineEntry, next: MachineEntry) =>
  pipe(
    HashMap.keys(previous.seen),
    Arr.fromIterable,
    Arr.filter((pane) => !HashMap.has(next.seen, pane)),
  )

const logStorageFailure = (what: string) => (error: SqlError) =>
  Effect.logError(
    `The hub could not store ${what} in its database, so it keeps it in memory only and loses it on restart: ${error.message}. Check the disk and the file at CROOK_HUB_DATABASE_PATH.`,
  )

const make = Effect.gen(function* () {
  const registry = yield* MachineRegistry
  const seenTracker = yield* SeenTracker
  const scope = yield* Effect.scope
  const records = yield* registry.all
  const marks = yield* seenTracker.all
  const entries = yield* SubscriptionRef.make(
    HashMap.fromIterable(
      Arr.map(records, (record): [MachineId, MachineEntry] => [
        record.id,
        fromRecord(marks)(record),
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
    SubscriptionRef.updateSomeEffect(entries, (current) =>
      DateTime.now.pipe(
        Effect.flatMap((now) => decide(HashMap.get(current, id), now)),
        Effect.map(Option.map((next) => HashMap.set(current, id, next))),
      ),
    )

  const saveIfChanged = (previous: Option.Option<MachineEntry>, next: MachineEntry) =>
    Option.exists(previous, (entry) => isSameRecord(toRecord(entry), toRecord(next)))
      ? Effect.void
      : registry.save(toRecord(next))

  const changeFromLink = (
    id: MachineId,
    update: (entry: MachineEntry, now: DateTime.Utc) => MachineEntry,
    afterwards: (
      previous: MachineEntry,
      next: MachineEntry,
    ) => Effect.Effect<void, SqlError> = () => Effect.void,
  ) =>
    change(id, (entry, now) => {
      const previous = Option.getOrElse(entry, () => firstSighting(id, now))
      const next = update(previous, now)

      return saveIfChanged(entry, next).pipe(
        Effect.andThen(afterwards(previous, next)),
        Effect.catchTag('SqlError', logStorageFailure(`machine ${id}`)),
        Effect.as(Option.some(next)),
      )
    })

  const visible = (id: MachineId, entry: Option.Option<MachineEntry>) =>
    entry.pipe(
      Option.filter((found) => !found.forgotten),
      Effect.fromOption,
      Effect.mapError(() => new MachineNotInHerd({ machine: id })),
    )

  const expireAfterGrace = (id: MachineId, entry: MachineEntry) =>
    entry.connection === 'reconnecting'
      ? Effect.sleep(RECONNECT_GRACE).pipe(
          Effect.andThen(
            change(id, (current) =>
              Effect.succeed(
                current.pipe(
                  Option.filter(stillDroppedSince(entry.connectionChangedAt)),
                  Option.map((dropped): MachineEntry => ({ ...dropped, connection: 'offline' })),
                ),
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
          Effect.andThen(SubscriptionRef.get(entries)),
          Effect.map((current) => HashMap.get(current, id)),
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
      Arr.match(forgottenPanes(previous, next), {
        onEmpty: () => Effect.void,
        onNonEmpty: (panes) => seenTracker.forgetPanes(id, panes),
      }),
    )
  })

  const forget = Effect.fn('Herd.forget')(function* (id: MachineId) {
    return yield* change(id, (entry) =>
      Effect.gen(function* () {
        const found = yield* visible(id, entry)

        if (found.connection !== 'offline') {
          return yield* new MachineStillConnected({ machine: id, connection: found.connection })
        }

        const next: MachineEntry = { ...found, forgotten: true }

        yield* registry.save(toRecord(next))

        return Option.some(next)
      }),
    )
  })

  const markSeen = Effect.fn('Herd.markSeen')(function* (id: MachineId, pane: PaneId) {
    return yield* change(id, (entry) =>
      Effect.gen(function* () {
        const found = yield* visible(id, entry)
        const row = yield* Arr.findFirst(agentsOf(found), (agent) => agent.pane === pane).pipe(
          Effect.fromOption,
          Effect.mapError(() => new PaneNotInHerd({ machine: id, pane })),
        )

        if (Option.contains(HashMap.get(found.seen, pane), row.stateChangeSeq)) {
          return Option.none()
        }

        yield* seenTracker.mark(
          new SeenRecord({ machine: id, pane, stateChangeSeq: row.stateChangeSeq }),
        )

        return Option.some({ ...found, seen: HashMap.set(found.seen, pane, row.stateChangeSeq) })
      }),
    )
  })

  return Herd.of({
    hold,
    publish,
    forget,
    markSeen,
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
    readonly view: Stream.Stream<HerdView>
  }
>()('@crook/hub/Herd') {
  static readonly layer = Layer.effect(this, make).pipe(
    Layer.provide([MachineRegistry.layer, SeenTracker.layer]),
  )
}
