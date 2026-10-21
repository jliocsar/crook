import * as Match from 'effect/Match'
import * as Schema from 'effect/Schema'

import { AbsolutePath } from '@crook/domain/AbsolutePath'
import { AgentRow } from '@crook/domain/AgentRow'
import { PaneId } from '@crook/domain/Ids'

const WITHOUT_CONTROL_CHARACTERS = /^\P{Cc}*$/u
const WITHOUT_WHITESPACE_OR_CONTROL_CHARACTERS = /^[^\s\p{Cc}]+$/u

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

export const AgentKind = Schema.Literals(['claude'])
export type AgentKind = typeof AgentKind.Type

export const FolderPath = AbsolutePath.check(Schema.isPattern(WITHOUT_CONTROL_CHARACTERS))

export const WorktreeBranch = Schema.String.check(
  Schema.isPattern(WITHOUT_WHITESPACE_OR_CONTROL_CHARACTERS),
)

export class StartAgent extends Schema.TaggedClass<StartAgent>()('StartAgent', {
  kind: AgentKind,
  folder: FolderPath,
  task: Schema.OptionFromNullOr(Schema.NonEmptyString),
}) {}

export class CreateWorktree extends Schema.TaggedClass<CreateWorktree>()('CreateWorktree', {
  kind: AgentKind,
  folder: FolderPath,
  branch: WorktreeBranch,
  task: Schema.OptionFromNullOr(Schema.NonEmptyString),
}) {}

export const PaneCommand = Schema.Union([Prompt, SendKeys, RenameAgent, ClosePane])
export type PaneCommand = typeof PaneCommand.Type

export const LaunchCommand = Schema.Union([StartAgent, CreateWorktree])
export type LaunchCommand = typeof LaunchCommand.Type

export const Command = Schema.Union([...PaneCommand.members, ...LaunchCommand.members])
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

export class AgentStarted extends Schema.TaggedClass<AgentStarted>()('AgentStarted', {
  pane: PaneId,
}) {}

export const CommandReceipt = Schema.Union([InputDelivered, PaneRenamed, PaneClosed, AgentStarted])
export type CommandReceipt = typeof CommandReceipt.Type

export const interrupt = (pane: PaneId) => new SendKeys({ pane, keys: [INTERRUPT_KEY] })

export const targetPane = (command: PaneCommand): PaneId =>
  Match.value(command).pipe(
    Match.tagsExhaustive({
      Prompt: (prompt) => prompt.pane,
      SendKeys: (sendKeys) => sendKeys.pane,
      RenameAgent: (rename) => rename.pane,
      ClosePane: (close) => close.pane,
    }),
  )

export const hasStarted = (receipt: AgentStarted, agents: readonly AgentRow[]) =>
  agents.some((row) => row.pane === receipt.pane)

export const hasMovedSince = (receipt: InputDelivered, row: AgentRow) =>
  row.pane === receipt.pane &&
  (row.terminal !== receipt.terminal || row.stateChangeSeq > receipt.stateChangeSeq)
