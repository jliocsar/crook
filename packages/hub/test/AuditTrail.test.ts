import { expect, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import { SqlError } from 'effect/sql/SqlError'

import { AuditPolicy } from '@crook/domain/Audit'
import { MachineId } from '@crook/domain/Ids'
import {
  AuditTrail,
  CrookHubAuditPolicy,
  DEFAULT_HUB_AUDIT_ARGUMENT_LIMIT,
  DEFAULT_HUB_AUDIT_REDACTED,
  HubAuditRecord,
} from '@crook/hub/AuditTrail'
import * as Database from '@crook/hub/Database'
import { MachineNotInHerd } from '@crook/protocol/ClientApi'

const LAPTOP = MachineId.make('laptop')
const OWNER = 'owner@example.com'

const forgetLaptop = {
  actor: OWNER,
  machine: LAPTOP,
  idempotencyKey: Option.none(),
  operation: 'ForgetMachine',
  arguments: {},
}

const trail = Layer.provideMerge(
  AuditTrail.layer,
  Layer.merge(Database.layerAt(':memory:'), ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
)

layer(trail)('AuditTrail', (it) => {
  it.effect('records an action with its outcome and hands the outcome back untouched', () =>
    Effect.gen(function* () {
      const audit = yield* AuditTrail
      const sql = yield* SqlClient.SqlClient
      const refusal = new MachineNotInHerd({ machine: LAPTOP })
      const answered = yield* Effect.succeed('forgotten').pipe(audit.audited(forgetLaptop))
      const refused = yield* Effect.fail(refusal).pipe(audit.audited(forgetLaptop), Effect.flip)
      const rows = yield* sql`SELECT * FROM audit ORDER BY id`
      const records = yield* Schema.decodeUnknownEffect(Schema.Array(HubAuditRecord))(rows)

      expect(answered).toBe('forgotten')
      expect(refused).toBe(refusal)
      expect(records.map((record) => [record.actor, record.outcome, record.failure])).toEqual([
        [OWNER, 'succeeded', Option.none()],
        [OWNER, 'failed', Option.some('MachineNotInHerd')],
      ])
    }),
  )

  it.effect('refuses to change or delete what it recorded', () =>
    Effect.gen(function* () {
      const audit = yield* AuditTrail
      const sql = yield* SqlClient.SqlClient

      yield* Effect.void.pipe(audit.audited(forgetLaptop))
      const before = yield* sql`SELECT * FROM audit ORDER BY id`
      const updated = yield* sql`UPDATE audit SET actor = 'someone@example.com'`.pipe(Effect.flip)
      const deleted = yield* sql`DELETE FROM audit`.pipe(Effect.flip)
      const after = yield* sql`SELECT * FROM audit ORDER BY id`

      expect(updated).toBeInstanceOf(SqlError)
      expect(deleted).toBeInstanceOf(SqlError)
      expect(after).toEqual(before)
    }),
  )

  it.effect('keeps prompt text out of the hub unless told otherwise', () =>
    Effect.gen(function* () {
      const defaults = yield* CrookHubAuditPolicy.parse(ConfigProvider.fromUnknown({}))
      const configured = yield* CrookHubAuditPolicy.parse(
        ConfigProvider.fromUnknown({ CROOK_HUB_AUDIT_REDACT: 'label' }),
      )

      expect(defaults).toEqual(
        new AuditPolicy({
          argumentLimit: DEFAULT_HUB_AUDIT_ARGUMENT_LIMIT,
          redactedArguments: DEFAULT_HUB_AUDIT_REDACTED,
        }),
      )
      expect(configured.redactedArguments).toEqual(['label'])
    }),
  )
})
