import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import type * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import type * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as SqlClient from 'effect/sql/SqlClient'
import type { SqlError } from 'effect/sql/SqlError'
import * as SqlSchema from 'effect/sql/SqlSchema'

import {
  AuditArguments,
  type AuditedOperation,
  AuditOutcome,
  applyAuditPolicy,
  auditExit,
  auditPolicyConfig,
} from '@crook/domain/Audit'
import { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import { dieOnUnencodableRecord } from '@crook/hub/Database'

export interface AuditRequest extends AuditedOperation {
  readonly actor: string
  readonly machine: MachineId
  readonly idempotencyKey: Option.Option<IdempotencyKey>
}

export const CrookHubAuditPolicy = auditPolicyConfig({
  limitVariable: 'CROOK_HUB_AUDIT_ARGUMENT_LIMIT',
  redactVariable: 'CROOK_HUB_AUDIT_REDACT',
  redactedByDefault: ['text'],
})

export class HubAuditRecord extends Schema.Class<HubAuditRecord>('HubAuditRecord')({
  at: Schema.DateTimeUtcFromString,
  actor: Schema.String,
  operation: Schema.String,
  machine: MachineId,
  arguments: Schema.fromJsonString(AuditArguments),
  idempotencyKey: Schema.OptionFromNullOr(IdempotencyKey),
  outcome: AuditOutcome,
  failure: Schema.OptionFromNullOr(Schema.String),
}) {}

const logAuditFailure = (operation: string) => (error: SqlError) =>
  Effect.logError(
    `The hub could not write the audit entry for ${operation} to its database, so that action went unaudited: ${error.message}. Check the disk and the file at CROOK_HUB_DATABASE_PATH.`,
  )

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const policy = yield* CrookHubAuditPolicy

  const insert = SqlSchema.void({
    Request: HubAuditRecord,
    execute: (row) => sql`INSERT INTO audit ${sql.insert(row)}`,
  })

  const write = Effect.fn('AuditTrail.write')(function* (
    request: AuditRequest,
    exit: Exit.Exit<unknown, unknown>,
  ) {
    yield* insert(
      new HubAuditRecord({
        at: yield* DateTime.now,
        actor: request.actor,
        operation: request.operation,
        machine: request.machine,
        arguments: applyAuditPolicy(policy)(request.arguments),
        idempotencyKey: request.idempotencyKey,
        ...auditExit(exit),
      }),
    ).pipe(dieOnUnencodableRecord)
  })

  const audited =
    (request: AuditRequest) =>
    <Success, Failure, Requirements>(action: Effect.Effect<Success, Failure, Requirements>) =>
      action.pipe(
        Effect.onExit((exit) =>
          write(request, exit).pipe(
            Effect.catchTag('SqlError', logAuditFailure(request.operation)),
          ),
        ),
      )

  return AuditTrail.of({ audited })
})

export class AuditTrail extends Context.Service<
  AuditTrail,
  {
    readonly audited: (
      request: AuditRequest,
    ) => <Success, Failure, Requirements>(
      action: Effect.Effect<Success, Failure, Requirements>,
    ) => Effect.Effect<Success, Failure, Requirements>
  }
>()('@crook/hub/AuditTrail') {
  static readonly layer = Layer.effect(this, make)
}
