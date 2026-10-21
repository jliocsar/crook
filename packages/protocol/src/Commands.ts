import * as Duration from 'effect/Duration'
import * as Schema from 'effect/Schema'

import { Command, CommandReceipt } from '@crook/domain/Command'
import { AskId, IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'

export const CommandId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand('CommandId'),
)
export type CommandId = typeof CommandId.Type

export class RoutedCommand extends Schema.Class<RoutedCommand>('RoutedCommand')({
  id: CommandId,
  key: IdempotencyKey,
  command: Command,
}) {}

export class PaneNotAgent extends Schema.TaggedError<PaneNotAgent>()('PaneNotAgent', {
  pane: PaneId,
}) {
  override get message(): string {
    return `Pane ${this.pane} does not host an agent herdr recognizes, so crook refuses to type into it. The agent may have exited or the pane closed: refresh the herd and pick a live agent.`
  }
}

export class PaneNotCreatedByCrook extends Schema.TaggedError<PaneNotCreatedByCrook>()(
  'PaneNotCreatedByCrook',
  { pane: PaneId },
) {
  override get message(): string {
    return `crook did not create pane ${this.pane}, so it will not close it unless you confirm that you mean it. Nothing was closed: confirm the close to close it anyway.`
  }
}

export class HerdrRefusedCommand extends Schema.TaggedError<HerdrRefusedCommand>()(
  'HerdrRefusedCommand',
  { code: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Herdr refused the command with ${this.code}: ${this.detail}. Nothing was sent to the agent; look at the agent before trying again.`
  }
}

export class HerdrUnavailable extends Schema.TaggedError<HerdrUnavailable>()(
  'HerdrUnavailable',
  {},
) {
  override get message(): string {
    return 'The agent could not reach herdr on its machine, so nothing was sent. Check that herdr is running there, then send again.'
  }
}

export class CommandDeliveryUnknown extends Schema.TaggedError<CommandDeliveryUnknown>()(
  'CommandDeliveryUnknown',
  {},
) {
  override get message(): string {
    return 'Herdr stopped answering after the command went out, so the input may or may not have reached the agent. crook will not resend it under the same key: look at the agent, and send it again as a new action if it did not arrive.'
  }
}

export class AskNotPending extends Schema.TaggedError<AskNotPending>()('AskNotPending', {
  pane: PaneId,
  ask: AskId,
}) {
  override get message(): string {
    return `Pane ${this.pane} is no longer waiting on the ask you answered (${this.ask}): Claude moved on, or it is asking something else now. Nothing was sent; look at what the agent asks now and answer that.`
  }
}

export class AskDialogUnreadable extends Schema.TaggedError<AskDialogUnreadable>()(
  'AskDialogUnreadable',
  { pane: PaneId },
) {
  override get message(): string {
    return `crook could not read the dialog's options from pane ${this.pane}'s screen, so it did not guess which key answers it. Nothing was sent; decline the ask, or answer it in the terminal.`
  }
}

export class AskOptionUnavailable extends Schema.TaggedError<AskOptionUnavailable>()(
  'AskOptionUnavailable',
  { pane: PaneId, option: Schema.String },
) {
  override get message(): string {
    return `The dialog on pane ${this.pane} offers no "${this.option}" option, so nothing was sent. Pick one of the options it shows.`
  }
}

export class QuestionnaireUnsupported extends Schema.TaggedError<QuestionnaireUnsupported>()(
  'QuestionnaireUnsupported',
  { pane: PaneId },
) {
  override get message(): string {
    return `crook can only pick the answer to a single question with a single choice, and the questionnaire on pane ${this.pane} is not one. Nothing was sent; answer it in the terminal, or decline it with a message.`
  }
}

export class DeclineMessageUndelivered extends Schema.TaggedError<DeclineMessageUndelivered>()(
  'DeclineMessageUndelivered',
  { pane: PaneId, reason: Schema.String },
) {
  override get message(): string {
    return `The ask on pane ${this.pane} was declined, but your message did not reach Claude: ${this.reason}. Send the message again as a prompt.`
  }
}

export class MachineOffline extends Schema.TaggedError<MachineOffline>()('MachineOffline', {
  machine: MachineId,
}) {
  override get message(): string {
    return `Machine "${this.machine}" is offline, so the command was not sent. Send it again once the machine shows online.`
  }
}

export class CommandTimedOut extends Schema.TaggedError<CommandTimedOut>()('CommandTimedOut', {
  machine: MachineId,
  timeout: Schema.DurationFromMillis,
}) {
  override get message(): string {
    return `Machine "${this.machine}" did not answer the command within ${Duration.format(this.timeout)}. It may still run: send it again with the same idempotency key, and the agent answers with the first outcome instead of running it twice.`
  }
}

export const AgentCommandFailure = Schema.Union([
  PaneNotAgent,
  PaneNotCreatedByCrook,
  HerdrRefusedCommand,
  HerdrUnavailable,
  CommandDeliveryUnknown,
  AskNotPending,
  AskDialogUnreadable,
  AskOptionUnavailable,
  QuestionnaireUnsupported,
  DeclineMessageUndelivered,
])
export type AgentCommandFailure = typeof AgentCommandFailure.Type

export const CommandFailure = Schema.Union([
  MachineOffline,
  CommandTimedOut,
  ...AgentCommandFailure.members,
])
export type CommandFailure = typeof CommandFailure.Type

export const CommandResult = Schema.Result(CommandReceipt, AgentCommandFailure)
export type CommandResult = typeof CommandResult.Type
