import * as Duration from 'effect/Duration'
import * as Schema from 'effect/Schema'

import { Command, CommandReceipt } from '@crook/domain/Command'
import { IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'

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

export class FolderNotFound extends Schema.TaggedError<FolderNotFound>()('FolderNotFound', {
  folder: Schema.String,
}) {
  override get message(): string {
    return `There is no folder ${this.folder} on the machine, so crook started nothing: herdr would have opened the new tab in the home folder instead. Pick a folder that exists, or check the path for a typo.`
  }
}

export class AgentNotStarted extends Schema.TaggedError<AgentNotStarted>()('AgentNotStarted', {
  folder: Schema.String,
  code: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Claude did not start in ${this.folder}: herdr answered ${this.code}, ${this.detail}. crook closed the tab it opened for it, apart from a new worktree, which stays on disk with its workspace. Look at the machine, then start the agent again as a new action.`
  }
}

export class TaskNotDelivered extends Schema.TaggedError<TaskNotDelivered>()('TaskNotDelivered', {
  pane: PaneId,
  code: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Claude started in pane ${this.pane}, but herdr did not deliver the task: ${this.code}, ${this.detail}. Claude may be waiting at a dialog, such as the folder trust prompt: open the agent, answer it, and send the task from its chat.`
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
  FolderNotFound,
  AgentNotStarted,
  TaskNotDelivered,
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
