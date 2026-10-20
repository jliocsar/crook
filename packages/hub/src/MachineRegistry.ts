import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import type { SqlError } from 'effect/sql/SqlError'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { MachineId } from '@crook/domain/Ids'
import { type StoredRowInvalid, decodeRows } from '@crook/hub/Database'

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

  const all = sql`SELECT * FROM machines`.pipe(
    Effect.flatMap(decodeRows('machines', MachineRecord)),
    Effect.withSpan('MachineRegistry.all'),
  )

  const save = Effect.fn('MachineRegistry.save')(function* (record: MachineRecord) {
    const row = {
      id: record.id,
      label: record.label,
      lastSeenAt: DateTime.formatIso(record.lastSeenAt),
      forgotten: record.forgotten,
      agentVersion: Option.getOrNull(record.agentVersion),
      herdrVersion: Option.getOrNull(record.herdrVersion),
    }

    yield* sql`
      INSERT INTO machines ${sql.insert(row)}
      ON CONFLICT (id) DO UPDATE SET
        label = excluded.label,
        last_seen_at = excluded.last_seen_at,
        forgotten = excluded.forgotten,
        agent_version = excluded.agent_version,
        herdr_version = excluded.herdr_version
    `
  })

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
