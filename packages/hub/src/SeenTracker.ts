import type * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import type { SqlError } from 'effect/sql/SqlError'
import * as SqlSchema from 'effect/sql/SqlSchema'

import { AgentRow } from '@crook/domain/AgentRow'
import { MachineId, PaneId } from '@crook/domain/Ids'
import {
  type StoredRowInvalid,
  dieOnUnencodableRecord,
  storedRowInvalidIn,
} from '@crook/hub/Database'

export class SeenRecord extends Schema.Class<SeenRecord>('SeenRecord')({
  machine: MachineId,
  pane: PaneId,
  terminal: AgentRow.fields.terminal,
  stateChangeSeq: AgentRow.fields.stateChangeSeq,
}) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const findAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: SeenRecord,
    execute: () => sql`SELECT * FROM seen`,
  })

  const upsert = SqlSchema.void({
    Request: SeenRecord,
    execute: (row) => sql`
      INSERT INTO seen ${sql.insert(row)}
      ON CONFLICT (machine, pane) DO UPDATE SET
        terminal = excluded.terminal,
        state_change_seq = excluded.state_change_seq
    `,
  })

  const all = findAll(undefined).pipe(
    storedRowInvalidIn('seen'),
    Effect.withSpan('SeenTracker.all'),
  )

  const mark = (record: SeenRecord) =>
    upsert(record).pipe(dieOnUnencodableRecord, Effect.withSpan('SeenTracker.mark'))

  const dropPanes = Effect.fn('SeenTracker.dropPanes')(function* (
    machine: MachineId,
    panes: Arr.NonEmptyReadonlyArray<PaneId>,
  ) {
    yield* sql`DELETE FROM seen WHERE machine = ${machine} AND ${sql.in('pane', panes)}`
  })

  return SeenTracker.of({ all, mark, dropPanes })
})

export class SeenTracker extends Context.Service<
  SeenTracker,
  {
    readonly all: Effect.Effect<readonly SeenRecord[], SqlError | StoredRowInvalid>
    readonly mark: (record: SeenRecord) => Effect.Effect<void, SqlError>
    readonly dropPanes: (
      machine: MachineId,
      panes: Arr.NonEmptyReadonlyArray<PaneId>,
    ) => Effect.Effect<void, SqlError>
  }
>()('@crook/hub/SeenTracker') {
  static readonly layer = Layer.effect(this, make)
}
