import * as Arr from 'effect/Array'
import * as Equivalence from 'effect/Equivalence'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
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

export class RenameAgent extends Schema.TaggedClass<RenameAgent>()('RenameAgent', {
  pane: PaneId,
  label: Schema.OptionFromNullOr(Schema.NonEmptyString),
}) {}

export class ClosePane extends Schema.TaggedClass<ClosePane>()('ClosePane', {
  pane: PaneId,
  confirmed: Schema.Boolean,
}) {}

export const Command = Schema.Union([Prompt, SendKeys, RenameAgent, ClosePane])
export type Command = typeof Command.Type

export class InputDelivered extends Schema.TaggedClass<InputDelivered>()('InputDelivered', {
  pane: PaneId,
  stateChangeSeq: AgentRow.fields.stateChangeSeq,
}) {}

export class PaneRenamed extends Schema.TaggedClass<PaneRenamed>()('PaneRenamed', {
  pane: PaneId,
  label: RenameAgent.fields.label,
}) {}

export class PaneClosed extends Schema.TaggedClass<PaneClosed>()('PaneClosed', {
  pane: PaneId,
}) {}

export const CommandReceipt = Schema.Union([InputDelivered, PaneRenamed, PaneClosed])
export type CommandReceipt = typeof CommandReceipt.Type

const isSameLabel = Option.makeEquivalence(Equivalence.String)

export const interrupt = (pane: PaneId) => new SendKeys({ pane, keys: [INTERRUPT_KEY] })

export const targetPane = (command: Command): PaneId =>
  Match.value(command).pipe(
    Match.tagsExhaustive({
      Prompt: (prompt) => prompt.pane,
      SendKeys: (sendKeys) => sendKeys.pane,
      RenameAgent: (rename) => rename.pane,
      ClosePane: (close) => close.pane,
    }),
  )

export const hasMovedSince = (receipt: InputDelivered, row: AgentRow) =>
  row.pane === receipt.pane && row.stateChangeSeq > receipt.stateChangeSeq

export const isObservedIn = (receipt: CommandReceipt, agents: readonly AgentRow[]): boolean => {
  const row = Arr.findFirst(agents, (agent) => agent.pane === receipt.pane)

  return Match.value(receipt).pipe(
    Match.tagsExhaustive({
      InputDelivered: (delivered) => Option.exists(row, (found) => hasMovedSince(delivered, found)),
      PaneRenamed: (renamed) =>
        Option.exists(row, (found) => isSameLabel(found.label, renamed.label)),
      PaneClosed: () => Option.isNone(row),
    }),
  )
}
