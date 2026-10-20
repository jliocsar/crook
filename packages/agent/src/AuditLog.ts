import * as Config from 'effect/Config'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import type * as Exit from 'effect/Exit'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Semaphore from 'effect/Semaphore'

import { CrookMachineId } from '@crook/agent/MachineStateSync'
import {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  stateFile,
} from '@crook/agent/StateDirectory'
import {
  AuditArguments,
  AuditOutcome,
  AuditPolicy,
  applyAuditPolicy,
  auditExit,
  commandAudit,
} from '@crook/domain/Audit'
import type { Command } from '@crook/domain/Command'
import { IdempotencyKey, MachineId } from '@crook/domain/Ids'

export type AuditRecorder = (
  key: IdempotencyKey,
  command: Command,
  exit: Exit.Exit<unknown, unknown>,
) => Effect.Effect<void, AuditLogUnwritable>

export const DEFAULT_AUDIT_ARGUMENT_LIMIT = 200

export const CrookAuditLogPath = stateFile('CROOK_AUDIT_LOG_PATH', 'audit.jsonl')

export const CrookAuditPolicy = Config.all({
  argumentLimit: Config.schema(AuditPolicy.fields.argumentLimit, 'CROOK_AUDIT_ARGUMENT_LIMIT').pipe(
    Config.withDefault(DEFAULT_AUDIT_ARGUMENT_LIMIT),
  ),
  redactedArguments: Config.Array(Schema.NonEmptyString, 'CROOK_AUDIT_REDACT').pipe(
    Config.withDefault([]),
  ),
}).pipe(Config.map((fields) => new AuditPolicy(fields)))

export class AgentAuditEntry extends Schema.Class<AgentAuditEntry>('AgentAuditEntry')({
  at: Schema.DateTimeUtcFromString,
  machine: MachineId,
  key: IdempotencyKey,
  operation: Schema.String,
  arguments: AuditArguments,
  outcome: AuditOutcome,
  failure: Schema.OptionFromNullOr(Schema.String),
}) {}

export const AuditLine = Schema.fromJsonString(AgentAuditEntry)

export class AuditLogUnwritable extends Schema.TaggedError<AuditLogUnwritable>()(
  'AuditLogUnwritable',
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not append to the audit log at ${this.path}, so this command ran without an audit entry. Check the disk and the permissions of that file, or point CROOK_AUDIT_LOG_PATH elsewhere.`
  }
}

const entryFor = Effect.fn('AuditLog.entryFor')(function* (
  machine: MachineId,
  policy: AuditPolicy,
  key: IdempotencyKey,
  command: Command,
  exit: Exit.Exit<unknown, unknown>,
) {
  const { operation, arguments: commandArguments } = commandAudit(command)

  return new AgentAuditEntry({
    at: yield* DateTime.now,
    machine,
    key,
    operation,
    arguments: applyAuditPolicy(policy)(commandArguments),
    ...auditExit(exit),
  })
})

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const file = yield* CrookAuditLogPath
  const policy = yield* CrookAuditPolicy
  const machine = yield* CrookMachineId
  const appending = yield* Semaphore.make(1)

  const append = (entry: AgentAuditEntry) =>
    fileSystem
      .makeDirectory(path.dirname(file), { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE })
      .pipe(
        Effect.andThen(
          fileSystem.writeFileString(file, `${Schema.encodeSync(AuditLine)(entry)}\n`, {
            flag: 'a',
            mode: OWNER_ONLY_FILE_MODE,
          }),
        ),
        Effect.mapError((cause) => new AuditLogUnwritable({ path: file, cause })),
        appending.withPermits(1),
      )

  const record: AuditRecorder = (key, command, exit) =>
    entryFor(machine, policy, key, command, exit).pipe(
      Effect.flatMap(append),
      Effect.withSpan('AuditLog.record'),
    )

  return AuditLog.of({ record })
})

export class AuditLog extends Context.Service<AuditLog, { readonly record: AuditRecorder }>()(
  '@crook/agent/AuditLog',
) {
  static readonly layer = Layer.effect(this, make)

  static readonly layerTest = (
    entries: Queue.Queue<AgentAuditEntry>,
    machine: MachineId,
    policy: AuditPolicy,
  ) =>
    Layer.succeed(
      this,
      AuditLog.of({
        record: (key, command, exit) =>
          entryFor(machine, policy, key, command, exit).pipe(
            Effect.flatMap((entry) => Queue.offer(entries, entry)),
          ),
      }),
    )
}
