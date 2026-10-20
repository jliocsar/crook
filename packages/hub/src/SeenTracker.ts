import type * as NonEmptyArray from 'effect/Array'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import type { SqlError } from 'effect/sql/SqlError'

import { MachineId, PaneId } from '@crook/domain/Ids'
import { type StoredRowInvalid, decodeRows } from '@crook/hub/Database'

export class SeenRecord extends Schema.Class<SeenRecord>('SeenRecord')({
  machine: MachineId,
  pane: PaneId,
  stateChangeSeq: Schema.Int,
}) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const all = sql`SELECT * FROM seen`.pipe(
    Effect.flatMap(decodeRows('seen', SeenRecord)),
    Effect.withSpan('SeenTracker.all'),
  )

  const mark = Effect.fn('SeenTracker.mark')(function* (record: SeenRecord) {
    const row = {
      machine: record.machine,
      pane: record.pane,
      stateChangeSeq: record.stateChangeSeq,
    }

    yield* sql`
      INSERT INTO seen ${sql.insert(row)}
      ON CONFLICT (machine, pane) DO UPDATE SET state_change_seq = excluded.state_change_seq
    `
  })

  const forgetPanes = Effect.fn('SeenTracker.forgetPanes')(function* (
    machine: MachineId,
    panes: NonEmptyArray.NonEmptyReadonlyArray<PaneId>,
  ) {
    yield* sql`DELETE FROM seen WHERE machine = ${machine} AND ${sql.in('pane', panes)}`
  })

  return SeenTracker.of({ all, mark, forgetPanes })
})

export class SeenTracker extends Context.Service<
  SeenTracker,
  {
    readonly all: Effect.Effect<readonly SeenRecord[], SqlError | StoredRowInvalid>
    readonly mark: (record: SeenRecord) => Effect.Effect<void, SqlError>
    readonly forgetPanes: (
      machine: MachineId,
      panes: NonEmptyArray.NonEmptyReadonlyArray<PaneId>,
    ) => Effect.Effect<void, SqlError>
  }
>()('@crook/hub/SeenTracker') {
  static readonly layer = Layer.effect(this, make)
}
