import * as Schema from 'effect/Schema'

import { AgentRow } from '@crook/domain/AgentRow'
import { PaneId } from '@crook/domain/Ids'

export const INTERRUPT_KEY = 'esc'

export class Prompt extends Schema.TaggedClass<Prompt>()('Prompt', {
  pane: PaneId,
  text: Schema.NonEmptyString,
}) {}

export class SendKeys extends Schema.TaggedClass<SendKeys>()('SendKeys', {
  pane: PaneId,
  keys: Schema.NonEmptyArray(Schema.NonEmptyString),
}) {}

export const Command = Schema.Union([Prompt, SendKeys])
export type Command = typeof Command.Type

export class InputDelivered extends Schema.TaggedClass<InputDelivered>()('InputDelivered', {
  pane: PaneId,
  stateChangeSeq: AgentRow.fields.stateChangeSeq,
}) {}

export const CommandReceipt = Schema.Union([InputDelivered])
export type CommandReceipt = typeof CommandReceipt.Type

export const interrupt = (pane: PaneId) => new SendKeys({ pane, keys: [INTERRUPT_KEY] })

export const hasMovedSince = (receipt: InputDelivered, row: AgentRow) =>
  row.pane === receipt.pane && row.stateChangeSeq > receipt.stateChangeSeq
