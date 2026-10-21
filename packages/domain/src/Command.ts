import * as Match from 'effect/Match'
import * as Schema from 'effect/Schema'

import { AgentRow } from '@crook/domain/AgentRow'
import { AskId, PaneId } from '@crook/domain/Ids'

const WITHOUT_CONTROL_CHARACTERS = /^\P{Cc}*$/u

export const INTERRUPT_KEY = 'esc'

export const PaneLabel = Schema.Trimmed.check(
  Schema.isNonEmpty(),
  Schema.isPattern(WITHOUT_CONTROL_CHARACTERS),
)

export class Prompt extends Schema.TaggedClass<Prompt>()('Prompt', {
  pane: PaneId,
  text: Schema.NonEmptyString,
}) {}

export class SendKeys extends Schema.TaggedClass<SendKeys>()('SendKeys', {
  pane: PaneId,
  keys: Schema.NonEmptyArray(Schema.NonEmptyString),
}) {}

export class RenameAgent extends Schema.TaggedClass<RenameAgent>()('RenameAgent', {
  pane: PaneId,
  label: Schema.OptionFromNullOr(PaneLabel),
}) {}

export class ClosePane extends Schema.TaggedClass<ClosePane>()('ClosePane', {
  pane: PaneId,
  confirmed: Schema.Boolean,
}) {}

export class Approve extends Schema.TaggedClass<Approve>()('Approve', {}) {}

export class ApproveAlways extends Schema.TaggedClass<ApproveAlways>()('ApproveAlways', {}) {}

export class Decline extends Schema.TaggedClass<Decline>()('Decline', {
  message: Schema.OptionFromNullOr(Schema.NonEmptyString),
}) {}

export class Choose extends Schema.TaggedClass<Choose>()('Choose', {
  answers: Schema.NonEmptyArray(Schema.NonEmptyString),
}) {}

export const AskAnswer = Schema.Union([Approve, ApproveAlways, Decline, Choose])
export type AskAnswer = typeof AskAnswer.Type

export class AnswerAsk extends Schema.TaggedClass<AnswerAsk>()('AnswerAsk', {
  pane: PaneId,
  ask: AskId,
  answer: AskAnswer,
}) {}

export const Command = Schema.Union([Prompt, SendKeys, RenameAgent, ClosePane, AnswerAsk])
export type Command = typeof Command.Type

export class InputDelivered extends Schema.TaggedClass<InputDelivered>()('InputDelivered', {
  pane: PaneId,
  terminal: AgentRow.fields.terminal,
  stateChangeSeq: AgentRow.fields.stateChangeSeq,
}) {}

export class PaneRenamed extends Schema.TaggedClass<PaneRenamed>()('PaneRenamed', {
  pane: PaneId,
  label: AgentRow.fields.label,
}) {}

export class PaneClosed extends Schema.TaggedClass<PaneClosed>()('PaneClosed', {
  pane: PaneId,
}) {}

export const CommandReceipt = Schema.Union([InputDelivered, PaneRenamed, PaneClosed])
export type CommandReceipt = typeof CommandReceipt.Type

export const interrupt = (pane: PaneId) => new SendKeys({ pane, keys: [INTERRUPT_KEY] })

export const targetPane = (command: Command): PaneId =>
  Match.value(command).pipe(
    Match.tagsExhaustive({
      Prompt: (prompt) => prompt.pane,
      SendKeys: (sendKeys) => sendKeys.pane,
      RenameAgent: (rename) => rename.pane,
      ClosePane: (close) => close.pane,
      AnswerAsk: (answer) => answer.pane,
    }),
  )

export const hasMovedSince = (receipt: InputDelivered, row: AgentRow) =>
  row.pane === receipt.pane &&
  (row.terminal !== receipt.terminal || row.stateChangeSeq > receipt.stateChangeSeq)
