import * as Cause from 'effect/Cause'
import * as Exit from 'effect/Exit'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Record from 'effect/Record'
import * as Schema from 'effect/Schema'

import type { Command } from '@crook/domain/Command'

export interface AuditedOperation {
  readonly operation: string
  readonly arguments: AuditArguments
}

export interface AuditedExit {
  readonly outcome: AuditOutcome
  readonly failure: Option.Option<string>
}

export const AuditValue = Schema.Union([
  Schema.String,
  Schema.Boolean,
  Schema.Array(Schema.String),
  Schema.Null,
])
export type AuditValue = typeof AuditValue.Type

export const AuditArguments = Schema.Record(Schema.String, AuditValue)
export type AuditArguments = typeof AuditArguments.Type

export const AuditOutcome = Schema.Literals(['succeeded', 'failed', 'interrupted'])
export type AuditOutcome = typeof AuditOutcome.Type

export class AuditPolicy extends Schema.Class<AuditPolicy>('AuditPolicy')({
  argumentLimit: Schema.Int.check(Schema.isGreaterThan(0)),
  redactedArguments: Schema.Array(Schema.String),
}) {}

export const REDACTED = '[redacted]'
export const TRUNCATION_MARK = '…'
export const DEFECT = 'Defect'

const truncate = (limit: number) => (text: string) => {
  const characters = Array.from(text)

  return characters.length > limit
    ? `${characters.slice(0, limit).join('')}${TRUNCATION_MARK}`
    : text
}

const truncateValue = (limit: number) => (value: AuditValue) =>
  Match.value(value).pipe(
    Match.when(Match.string, truncate(limit)),
    Match.when(Match.boolean, (flag): AuditValue => flag),
    Match.when(Predicate.isNull, (): AuditValue => null),
    Match.orElse((texts): AuditValue => texts.map(truncate(limit))),
  )

const failureName = (cause: Cause.Cause<unknown>) =>
  Cause.findErrorOption(cause).pipe(
    Option.map((error) => (error instanceof Error ? error.name : String(error))),
    Option.getOrElse(() => DEFECT),
  )

export const commandAudit = (command: Command): AuditedOperation =>
  Match.value(command).pipe(
    Match.tagsExhaustive({
      Prompt: (prompt) => ({
        operation: 'Prompt',
        arguments: { pane: prompt.pane, text: prompt.text },
      }),
      SendKeys: (sendKeys) => ({
        operation: 'SendKeys',
        arguments: { pane: sendKeys.pane, keys: sendKeys.keys },
      }),
      RenameAgent: (rename) => ({
        operation: 'RenameAgent',
        arguments: { pane: rename.pane, label: Option.getOrNull(rename.label) },
      }),
      ClosePane: (close) => ({
        operation: 'ClosePane',
        arguments: { pane: close.pane, confirmed: close.confirmed },
      }),
    }),
  )

export const applyAuditPolicy =
  (policy: AuditPolicy) =>
  (auditArguments: AuditArguments): AuditArguments =>
    Record.map(auditArguments, (value, name) =>
      policy.redactedArguments.includes(name)
        ? REDACTED
        : truncateValue(policy.argumentLimit)(value),
    )

export const auditExit = <Success, Failure>(exit: Exit.Exit<Success, Failure>): AuditedExit =>
  Exit.match(exit, {
    onSuccess: () => ({ outcome: 'succeeded', failure: Option.none() }),
    onFailure: (cause) =>
      Cause.hasInterruptsOnly(cause)
        ? { outcome: 'interrupted', failure: Option.none() }
        : { outcome: 'failed', failure: Option.some(failureName(cause)) },
  })
