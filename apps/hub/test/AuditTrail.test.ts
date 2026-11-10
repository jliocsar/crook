import { expect, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import { SqlError } from 'effect/sql/SqlError'

import { AuditPolicy, DEFAULT_AUDIT_ARGUMENT_LIMIT, REDACT_NOTHING } from '@crook/domain/Audit'
import { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import { INCONCLUSIVE_FAILURES } from '@crook/hub/ApprovalAnswerMachine'
import { AuditTrail, CrookHubAuditPolicy, HubAuditRecord } from '@crook/hub/AuditTrail'
import * as Database from '@crook/hub/Database'
import { MachineNotInHerd } from '@crook/protocol/ClientApi'
import { CommandTimedOut, MachineOffline } from '@crook/protocol/Commands'

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

  it.effect('records an action the phone abandoned midway as interrupted', () =>
    Effect.gen(function* () {
      const audit = yield* AuditTrail
      const sql = yield* SqlClient.SqlClient
      const started = yield* Deferred.make<void>()
      const abandoned = { ...forgetLaptop, operation: 'SendCommand' }
      const action = yield* Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        audit.audited(abandoned),
        Effect.forkChild,
      )

      yield* Deferred.await(started)
      yield* Fiber.interrupt(action)
      const rows = yield* sql`SELECT * FROM audit WHERE operation = ${abandoned.operation}`
      const records = yield* Schema.decodeUnknownEffect(Schema.Array(HubAuditRecord))(rows)

      expect(records.map((record) => [record.actor, record.outcome, record.failure])).toEqual([
        [OWNER, 'interrupted', Option.none()],
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
          argumentLimit: DEFAULT_AUDIT_ARGUMENT_LIMIT,
          redactedArguments: ['text'],
        }),
      )
      expect(configured.redactedArguments).toEqual(['label'])
    }),
  )

  it.effect('redacts nothing only when told so, and refuses a name it does not know', () =>
    Effect.gen(function* () {
      const policyFrom = (redact: string) =>
        CrookHubAuditPolicy.parse(ConfigProvider.fromUnknown({ CROOK_HUB_AUDIT_REDACT: redact }))
      const nothing = yield* policyFrom(REDACT_NOTHING)
      const misspelt = yield* Effect.exit(policyFrom('txt'))
      const padded = yield* Effect.exit(policyFrom('text, keys'))

      expect(nothing.redactedArguments).toEqual([])
      expect(Exit.isFailure(misspelt)).toBe(true)
      expect(Exit.isFailure(padded)).toBe(true)
    }),
  )
})

layer(trail)('AuditTrail reading an answer', (it) => {
  it.effect('reads the failures a send can still recover from as not concluding its key', () =>
    Effect.gen(function* () {
      const audit = yield* AuditTrail
      const key = IdempotencyKey.make('unsure-send')
      const recorded = audit.audited({ ...forgetLaptop, idempotencyKey: Option.some(key) })

      yield* Effect.exit(recorded(Effect.fail(new MachineOffline({ machine: LAPTOP }))))
      yield* Effect.exit(
        recorded(
          Effect.fail(new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(5) })),
        ),
      )

      expect(yield* audit.hasConcluded(key, INCONCLUSIVE_FAILURES)).toBe(false)
    }),
  )
})
