import * as SqliteClient from '@effect/sql-sqlite-bun/SqliteClient'
import * as SqliteMigrator from '@effect/sql-sqlite-bun/SqliteMigrator'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import type { SqlError } from 'effect/sql/SqlError'
import * as Str from 'effect/String'

export const CrookHubDatabasePath = Config.String('CROOK_HUB_DATABASE_PATH')

export class StoredRowInvalid extends Schema.TaggedError<StoredRowInvalid>()('StoredRowInvalid', {
  table: Schema.String,
  issue: Schema.String,
}) {
  override get message(): string {
    return `A row in the hub database's ${this.table} table does not have the shape this hub reads: ${this.issue}. The file was most likely written by another crook version; run the matching hub, or move the file at CROOK_HUB_DATABASE_PATH aside to start empty.`
  }
}

export const storedRowInvalidIn =
  (table: string) =>
  <Success, Requirements>(
    read: Effect.Effect<Success, SqlError | Schema.SchemaError, Requirements>,
  ): Effect.Effect<Success, SqlError | StoredRowInvalid, Requirements> =>
    read.pipe(
      Effect.catchTag('SchemaError', (error) =>
        Effect.fail(new StoredRowInvalid({ table, issue: error.message })),
      ),
    )

export const dieOnUnencodableRecord = <Success, Requirements>(
  write: Effect.Effect<Success, SqlError | Schema.SchemaError, Requirements>,
): Effect.Effect<Success, SqlError, Requirements> =>
  write.pipe(Effect.catchTag('SchemaError', (error) => Effect.die(error)))

const createMachines = Effect.flatMap(
  SqlClient.SqlClient,
  (sql) => sql`
    CREATE TABLE machines (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      forgotten INTEGER NOT NULL DEFAULT 0,
      agent_version TEXT,
      herdr_version TEXT
    )
  `,
)

const createSeen = Effect.flatMap(
  SqlClient.SqlClient,
  (sql) => sql`
    CREATE TABLE seen (
      machine TEXT NOT NULL,
      pane TEXT NOT NULL,
      state_change_seq INTEGER NOT NULL,
      PRIMARY KEY (machine, pane)
    )
  `,
)

const createPins = Effect.flatMap(
  SqlClient.SqlClient,
  (sql) => sql`
    CREATE TABLE pins (
      machine TEXT NOT NULL,
      pane TEXT NOT NULL,
      PRIMARY KEY (machine, pane)
    )
  `,
)

const createAudit = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      operation TEXT NOT NULL,
      machine TEXT NOT NULL,
      arguments TEXT NOT NULL,
      idempotency_key TEXT,
      outcome TEXT NOT NULL,
      failure TEXT
    )
  `
  yield* sql`
    CREATE TRIGGER audit_is_append_only_on_update BEFORE UPDATE ON audit
    BEGIN SELECT RAISE(ABORT, 'the audit table is append-only'); END
  `
  yield* sql`
    CREATE TRIGGER audit_is_append_only_on_delete BEFORE DELETE ON audit
    BEGIN SELECT RAISE(ABORT, 'the audit table is append-only'); END
  `
})

const migrations = SqliteMigrator.fromRecord({
  '1_machines': createMachines,
  '2_seen': createSeen,
  '3_pins': createPins,
  '4_audit': createAudit,
})

export const layerAt = (filename: string) =>
  SqliteMigrator.layer({ loader: migrations }).pipe(
    Layer.provideMerge(
      SqliteClient.layer({
        filename,
        transformQueryNames: Str.camelToSnake,
        transformResultNames: Str.snakeToCamel,
      }),
    ),
  )

export const layer = Layer.unwrap(Effect.map(CrookHubDatabasePath, layerAt))
