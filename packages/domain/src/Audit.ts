import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Config from 'effect/Config'
import * as Exit from 'effect/Exit'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Schema from 'effect/Schema'

import type { AskAnswer, Command } from '@crook/domain/Command'

export interface AuditedOperation {
  readonly operation: string
  readonly arguments: AuditArguments
}

export interface AuditedExit {
  readonly outcome: AuditOutcome
  readonly failure: Option.Option<string>
}

export interface AuditPolicyVariables {
  readonly limitVariable: string
  readonly redactVariable: string
  readonly redactedByDefault: readonly AuditArgumentName[]
}

export const AuditArgumentName = Schema.Literals([
  'pane',
  'text',
  'keys',
  'label',
  'confirmed',
  'pinned',
  'ask',
  'answer',
  'choices',
])
export type AuditArgumentName = typeof AuditArgumentName.Type

export const AuditValue = Schema.Union([
  Schema.String,
  Schema.Boolean,
  Schema.Array(Schema.String),
  Schema.Null,
])
export type AuditValue = typeof AuditValue.Type

export const AuditArguments = Schema.Record(AuditArgumentName, Schema.optionalKey(AuditValue))
export type AuditArguments = typeof AuditArguments.Type

export const AuditOutcome = Schema.Literals(['succeeded', 'failed', 'interrupted'])
export type AuditOutcome = typeof AuditOutcome.Type

export class AuditPolicy extends Schema.Class<AuditPolicy>('AuditPolicy')({
  argumentLimit: Schema.Int.check(Schema.isGreaterThan(0)),
  redactedArguments: Schema.Array(AuditArgumentName),
}) {}

export const DEFAULT_AUDIT_ARGUMENT_LIMIT = 200
export const REDACT_NOTHING = 'none'
export const REDACTED = '[redacted]'
export const TRUNCATION_MARK = '…'
export const DEFECT = 'Defect'

const characterCount = (text: string) => Array.from(text).length

const firstCharacters = (count: number) => (text: string) =>
  Array.from(text).slice(0, count).join('')

const truncate = (limit: number) => (text: string) =>
  characterCount(text) > limit ? `${firstCharacters(limit)(text)}${TRUNCATION_MARK}` : text

const markLastAsCut = (kept: readonly string[]): readonly string[] =>
  Arr.match(kept, {
    onEmpty: () => [TRUNCATION_MARK],
    onNonEmpty: (nonEmpty) =>
      Arr.modifyLastNonEmpty(nonEmpty, (last) => `${last}${TRUNCATION_MARK}`),
  })

const truncateTexts = (limit: number) => (texts: readonly string[]) => {
  const remainingBefore = Arr.scan(
    texts,
    limit,
    (remaining, text) => remaining - characterCount(text),
  )
  const kept = pipe(
    Arr.zip(remainingBefore, texts),
    Arr.takeWhile(([remaining]) => remaining > 0),
    Arr.map(([remaining, text]) => firstCharacters(remaining)(text)),
  )

  return Arr.lastNonEmpty(remainingBefore) < 0 ? markLastAsCut(kept) : kept
}

const truncateValue = (limit: number) => (value: AuditValue) =>
  Match.type<AuditValue>().pipe(
    Match.when(Match.string, truncate(limit)),
    Match.when(Arr.isArray, truncateTexts(limit)),
    Match.orElse((untouched) => untouched),
  )(value)

const failureName = (cause: Cause.Cause<unknown>) =>
  Cause.findErrorOption(cause).pipe(
    Option.map((error) => (error instanceof Error ? error.name : String(error))),
    Option.getOrElse(() => DEFECT),
  )

export const auditPolicyConfig = ({
  limitVariable,
  redactVariable,
  redactedByDefault,
}: AuditPolicyVariables) =>
  Config.all({
    argumentLimit: Config.schema(AuditPolicy.fields.argumentLimit, limitVariable).pipe(
      Config.withDefault(DEFAULT_AUDIT_ARGUMENT_LIMIT),
    ),
    redactedArguments: Config.Literal(REDACT_NOTHING, redactVariable).pipe(
      Config.map((): readonly AuditArgumentName[] => []),
      Config.orElse(() => Config.Array(AuditArgumentName, redactVariable)),
      Config.withDefault(redactedByDefault),
    ),
  }).pipe(Config.map((fields) => new AuditPolicy(fields)))

const answerAudit = (answer: AskAnswer): AuditArguments =>
  Match.value(answer).pipe(
    Match.tagsExhaustive({
      Approve: () => ({ answer: 'Approve' }),
      ApproveAlways: () => ({ answer: 'ApproveAlways' }),
      Decline: (decline) => ({ answer: 'Decline', text: Option.getOrNull(decline.message) }),
      Choose: (choose) => ({ answer: 'Choose', choices: choose.answers }),
    }),
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
      AnswerAsk: (answerAsk) => ({
        operation: 'AnswerAsk',
        arguments: { pane: answerAsk.pane, ask: answerAsk.ask, ...answerAudit(answerAsk.answer) },
      }),
    }),
  )

export const applyAuditPolicy =
  (policy: AuditPolicy) =>
  (auditArguments: AuditArguments): AuditArguments =>
    Record.map<string, AuditValue, AuditValue>(auditArguments, (value, name) =>
      Arr.some(policy.redactedArguments, (redacted) => redacted === name)
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
