import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import type { SqlError } from 'effect/sql/SqlError'
import * as SqlSchema from 'effect/sql/SqlSchema'

import { MachineId, PaneId } from '@crook/domain/Ids'
import {
  type StoredRowInvalid,
  dieOnUnencodableRecord,
  storedRowInvalidIn,
} from '@crook/hub/Database'

export class PinRecord extends Schema.Class<PinRecord>('PinRecord')({
  machine: MachineId,
  pane: PaneId,
}) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const findAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: PinRecord,
    execute: () => sql`SELECT * FROM pins`,
  })

  const insert = SqlSchema.void({
    Request: PinRecord,
    execute: (row) =>
      sql`INSERT INTO pins ${sql.insert(row)} ON CONFLICT (machine, pane) DO NOTHING`,
  })

  const remove = SqlSchema.void({
    Request: PinRecord,
    execute: (row) => sql`DELETE FROM pins WHERE machine = ${row.machine} AND pane = ${row.pane}`,
  })

  const all = findAll(undefined).pipe(
    storedRowInvalidIn('pins'),
    Effect.withSpan('PinnedAgents.all'),
  )

  const pin = (record: PinRecord) =>
    insert(record).pipe(dieOnUnencodableRecord, Effect.withSpan('PinnedAgents.pin'))

  const unpin = (record: PinRecord) =>
    remove(record).pipe(dieOnUnencodableRecord, Effect.withSpan('PinnedAgents.unpin'))

  return PinnedAgents.of({ all, pin, unpin })
})

export class PinnedAgents extends Context.Service<
  PinnedAgents,
  {
    readonly all: Effect.Effect<readonly PinRecord[], SqlError | StoredRowInvalid>
    readonly pin: (record: PinRecord) => Effect.Effect<void, SqlError>
    readonly unpin: (record: PinRecord) => Effect.Effect<void, SqlError>
  }
>()('@crook/hub/PinnedAgents') {
  static readonly layer = Layer.effect(this, make)
}
