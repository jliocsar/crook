import { expect, it } from '@effect/vitest'
import * as SqliteMigrator from '@effect/sql-sqlite-bun/SqliteMigrator'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as SqlClient from 'effect/sql/SqlClient'

import * as Database from '@crook/hub/Database'
import { SeenTracker } from '@crook/hub/SeenTracker'

const IN_MEMORY = ':memory:'

const migrationsAsSeenShippedWithoutTerminal = SqliteMigrator.fromRecord({
  '1_machines': Effect.flatMap(
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
  ),
  '2_seen': Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql`
      CREATE TABLE seen (
        machine TEXT NOT NULL,
        pane TEXT NOT NULL,
        state_change_seq INTEGER NOT NULL,
        PRIMARY KEY (machine, pane)
      )
    `,
  ),
})

it.effect('upgrades a database whose seen marks carry no terminal, dropping those marks', () =>
  Effect.gen(function* () {
    const client = yield* Layer.build(Database.clientAt(IN_MEMORY))
    const marksBefore = yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient

      yield* SqliteMigrator.run({ loader: migrationsAsSeenShippedWithoutTerminal })
      yield* sql`INSERT INTO seen ${sql.insert({ machine: 'laptop', pane: 'w1:p1', stateChangeSeq: 7 })}`

      return yield* sql`SELECT * FROM seen`
    }).pipe(Effect.provide(client))
    const upgraded = yield* Layer.build(
      Layer.provideMerge(
        SeenTracker.layer,
        Layer.provideMerge(Database.migrated, Layer.succeedContext(client)),
      ),
    )
    const marksAfter = yield* Effect.flatMap(SeenTracker, (seenTracker) => seenTracker.all).pipe(
      Effect.provide(upgraded),
    )

    expect(marksBefore).toEqual([{ machine: 'laptop', pane: 'w1:p1', stateChangeSeq: 7 }])
    expect(marksAfter).toEqual([])
  }),
)
