import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import type { SqlError } from 'effect/sql/SqlError'
import * as SqlSchema from 'effect/sql/SqlSchema'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { MachineId } from '@crook/domain/Ids'
import { type StoredRowInvalid, encodedRecord, rowsOf } from '@crook/hub/Database'

export class MachineRecord extends Schema.Class<MachineRecord>('MachineRecord')({
  id: MachineId,
  label: Schema.String,
  lastSeenAt: Schema.DateTimeUtcFromString,
  forgotten: Schema.BooleanFromBit,
  agentVersion: Schema.OptionFromNullOr(CrookVersion),
  herdrVersion: Schema.OptionFromNullOr(Schema.String),
}) {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const findAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: MachineRecord,
    execute: () => sql`SELECT * FROM machines`,
  })

  const upsert = SqlSchema.void({
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

  const all = findAll(undefined).pipe(rowsOf('machines'), Effect.withSpan('MachineRegistry.all'))

  const save = (record: MachineRecord) =>
    upsert(record).pipe(encodedRecord, Effect.withSpan('MachineRegistry.save'))

  return MachineRegistry.of({ all, save })
})

export class MachineRegistry extends Context.Service<
  MachineRegistry,
  {
    readonly all: Effect.Effect<readonly MachineRecord[], SqlError | StoredRowInvalid>
    readonly save: (record: MachineRecord) => Effect.Effect<void, SqlError>
  }
>()('@crook/hub/MachineRegistry') {
  static readonly layer = Layer.effect(this, make)
}
