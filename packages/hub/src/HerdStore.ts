import type * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import type { SqlError } from 'effect/sql/SqlError'
import * as SqlSchema from 'effect/sql/SqlSchema'

import { AgentRow } from '@crook/domain/AgentRow'
import { CrookVersion } from '@crook/domain/CrookVersion'
import { MachineId, PaneId } from '@crook/domain/Ids'
import {
  type StoredRowInvalid,
  dieOnUnencodableRecord,
  storedRowInvalidIn,
} from '@crook/hub/Database'

export class MachineRecord extends Schema.Class<MachineRecord>('MachineRecord')({
  id: MachineId,
  label: Schema.String,
  lastSeenAt: Schema.DateTimeUtcFromString,
  forgotten: Schema.BooleanFromBit,
  agentVersion: Schema.OptionFromNullOr(CrookVersion),
  herdrVersion: Schema.OptionFromNullOr(Schema.String),
}) {}

export class SeenRecord extends Schema.Class<SeenRecord>('SeenRecord')({
  machine: MachineId,
  pane: PaneId,
  terminal: AgentRow.fields.terminal,
  stateChangeSeq: AgentRow.fields.stateChangeSeq,
}) {}

export class PinRecord extends Schema.Class<PinRecord>('PinRecord')({
  machine: MachineId,
  pane: PaneId,
}) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const findMachines = SqlSchema.findAll({
    Request: Schema.Void,
    Result: MachineRecord,
    execute: () => sql`SELECT * FROM machines`,
  })

  const upsertMachine = SqlSchema.void({
    Request: MachineRecord,
    execute: (row) => sql`
      INSERT INTO machines ${sql.insert(row)}
      ON CONFLICT (id) DO UPDATE SET
        label = excluded.label,
        last_seen_at = excluded.last_seen_at,
        forgotten = excluded.forgotten,
        agent_version = excluded.agent_version,
        herdr_version = excluded.herdr_version
    `,
  })

  const findSeenMarks = SqlSchema.findAll({
    Request: Schema.Void,
    Result: SeenRecord,
    execute: () => sql`SELECT * FROM seen`,
  })

  const upsertSeenMark = SqlSchema.void({
    Request: SeenRecord,
    execute: (row) => sql`
      INSERT INTO seen ${sql.insert(row)}
      ON CONFLICT (machine, pane) DO UPDATE SET
        terminal = excluded.terminal,
        state_change_seq = excluded.state_change_seq
    `,
  })

  const findPins = SqlSchema.findAll({
    Request: Schema.Void,
    Result: PinRecord,
    execute: () => sql`SELECT * FROM pins`,
  })

  const insertPin = SqlSchema.void({
    Request: PinRecord,
    execute: (row) =>
      sql`INSERT INTO pins ${sql.insert(row)} ON CONFLICT (machine, pane) DO NOTHING`,
  })

  const removePin = SqlSchema.void({
    Request: PinRecord,
    execute: (row) => sql`DELETE FROM pins WHERE machine = ${row.machine} AND pane = ${row.pane}`,
  })

  const machines = findMachines(undefined).pipe(
    storedRowInvalidIn('machines'),
    Effect.withSpan('HerdStore.machines'),
  )

  const saveMachine = (record: MachineRecord) =>
    upsertMachine(record).pipe(dieOnUnencodableRecord, Effect.withSpan('HerdStore.saveMachine'))

  const seenMarks = findSeenMarks(undefined).pipe(
    storedRowInvalidIn('seen'),
    Effect.withSpan('HerdStore.seenMarks'),
  )

  const markSeen = (record: SeenRecord) =>
    upsertSeenMark(record).pipe(dieOnUnencodableRecord, Effect.withSpan('HerdStore.markSeen'))

  const dropSeenPanes = Effect.fn('HerdStore.dropSeenPanes')(function* (
    machine: MachineId,
    panes: Arr.NonEmptyReadonlyArray<PaneId>,
  ) {
    yield* sql`DELETE FROM seen WHERE machine = ${machine} AND ${sql.in('pane', panes)}`
  })

  const pins = findPins(undefined).pipe(
    storedRowInvalidIn('pins'),
    Effect.withSpan('HerdStore.pins'),
  )

  const pin = (record: PinRecord) =>
    insertPin(record).pipe(dieOnUnencodableRecord, Effect.withSpan('HerdStore.pin'))

  const unpin = (record: PinRecord) =>
    removePin(record).pipe(dieOnUnencodableRecord, Effect.withSpan('HerdStore.unpin'))

  return HerdStore.of({
    machines,
    saveMachine,
    seenMarks,
    markSeen,
    dropSeenPanes,
    pins,
    pin,
    unpin,
  })
})

export class HerdStore extends Context.Service<
  HerdStore,
  {
    readonly machines: Effect.Effect<readonly MachineRecord[], SqlError | StoredRowInvalid>
    readonly saveMachine: (record: MachineRecord) => Effect.Effect<void, SqlError>
    readonly seenMarks: Effect.Effect<readonly SeenRecord[], SqlError | StoredRowInvalid>
    readonly markSeen: (record: SeenRecord) => Effect.Effect<void, SqlError>
    readonly dropSeenPanes: (
      machine: MachineId,
      panes: Arr.NonEmptyReadonlyArray<PaneId>,
    ) => Effect.Effect<void, SqlError>
    readonly pins: Effect.Effect<readonly PinRecord[], SqlError | StoredRowInvalid>
    readonly pin: (record: PinRecord) => Effect.Effect<void, SqlError>
    readonly unpin: (record: PinRecord) => Effect.Effect<void, SqlError>
  }
>()('@crook/hub/HerdStore') {
  static readonly layer = Layer.effect(this, make)
}
