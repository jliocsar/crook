import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { Command, CommandReceipt } from '@crook/domain/Command'
import { AskId, IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'
import { shellQuoted } from '@crook/domain/ShellQuoting'

export const CLAUDE_WAITING_CODE = 'claude_waiting'

export const CLAUDE_WAITING_NOTE =
  'Claude is waiting on the laptop, and its dialog would take this message. Answer it there, then send.'

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
    return `That pane does not host an agent herdr recognizes, so crook refuses to type into it. The agent may have exited or the pane closed: refresh the herd and pick a live agent.`
  }
}

export class PaneNotCreatedByCrook extends Schema.TaggedError<PaneNotCreatedByCrook>()(
  'PaneNotCreatedByCrook',
  { pane: PaneId },
) {
  override get message(): string {
    return `crook did not create this pane, so it will not close it unless you confirm that you mean it. Nothing was closed: confirm the close to close it anyway.`
  }
}

export class HerdrRefusedCommand extends Schema.TaggedError<HerdrRefusedCommand>()(
  'HerdrRefusedCommand',
  { code: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return this.code === CLAUDE_WAITING_CODE
      ? CLAUDE_WAITING_NOTE
      : `Herdr refused the command with ${this.code}: ${this.detail}. Nothing was sent to the agent; look at the agent before trying again.`
  }
}

export const claudeWaitingRefusal = () =>
  new HerdrRefusedCommand({
    code: CLAUDE_WAITING_CODE,
    detail: 'Claude is waiting on a dialog on the laptop, which would take this prompt',
  })

export class HerdrUnavailable extends Schema.TaggedError<HerdrUnavailable>()(
  'HerdrUnavailable',
  {},
) {
  override get message(): string {
    return 'The agent could not reach herdr on its machine, so nothing was sent. Check that herdr is running there, then send again.'
  }
}

export class HerdrAnswerUnreadable extends Schema.TaggedError<HerdrAnswerUnreadable>()(
  'HerdrAnswerUnreadable',
  { method: Schema.String, issue: Schema.String },
) {
  override get message(): string {
    return `Herdr answered ${this.method} with something crook cannot read (${this.issue}), so nothing was sent. The agent and herdr on that machine most likely speak different protocol versions: update one to match the other, then send again.`
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
    return `Claude is no longer waiting on the ask you answered: it moved on, or it is asking something else now. Nothing was sent; look at what the agent asks now and answer that.`
  }
}

export class AskDialogUnreadable extends Schema.TaggedError<AskDialogUnreadable>()(
  'AskDialogUnreadable',
  { pane: PaneId },
) {
  override get message(): string {
    return `crook could not read the dialog's options from the screen, so it did not guess which key answers it. Nothing was sent; decline the ask, or answer it in the terminal.`
  }
}

export class AskOptionUnavailable extends Schema.TaggedError<AskOptionUnavailable>()(
  'AskOptionUnavailable',
  { pane: PaneId, option: Schema.String },
) {
  override get message(): string {
    return `The dialog offers no "${this.option}" option, so nothing was sent. Pick one of the options it shows.`
  }
}

export class QuestionnaireUnsupported extends Schema.TaggedError<QuestionnaireUnsupported>()(
  'QuestionnaireUnsupported',
  { pane: PaneId },
) {
  override get message(): string {
    return `crook can only pick the answer to a single question with a single choice, and this questionnaire is not one. Nothing was sent; answer it in the terminal, or decline it with a message.`
  }
}

export class DeclineMessageUndelivered extends Schema.TaggedError<DeclineMessageUndelivered>()(
  'DeclineMessageUndelivered',
  { pane: PaneId, reason: Schema.String },
) {
  override get message(): string {
    return `The ask was declined, but your message did not reach Claude: ${this.reason}. Send the message again as a prompt.`
  }
}

export class FolderNotFound extends Schema.TaggedError<FolderNotFound>()('FolderNotFound', {
  folder: Schema.String,
}) {
  override get message(): string {
    return `There is no folder ${this.folder} on the machine, so crook started nothing: herdr would have opened the new tab in the home folder instead. Pick a folder that exists, or check the path for a typo.`
  }
}

export class FolderUnreadable extends Schema.TaggedError<FolderUnreadable>()('FolderUnreadable', {
  folder: Schema.String,
  reason: Schema.String,
}) {
  override get message(): string {
    return `crook could not look at the folder ${this.folder} on the machine (${this.reason}), so it started nothing. Check that the agent runs as a user who can read that folder, then start the agent again.`
  }
}

export class FolderNotCheckout extends Schema.TaggedError<FolderNotCheckout>()(
  'FolderNotCheckout',
  { folder: Schema.String },
) {
  override get message(): string {
    return `The folder ${this.folder} is not inside a git checkout, so crook cannot make a worktree from it and started nothing. Work in the folder itself, or pick a folder inside a repository.`
  }
}

export class AgentNotStarted extends Schema.TaggedError<AgentNotStarted>()('AgentNotStarted', {
  folder: Schema.String,
  worktree: Schema.OptionFromNullOr(Schema.String),
  code: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    const leftOnDisk = Option.match(this.worktree, {
      onNone: () => '',
      onSome: (path) =>
        `, but the worktree it made at ${path} stays on disk: remove it with \`git worktree remove ${shellQuoted(path)}\` if you do not want it`,
    })

    return `Claude did not start in ${this.folder}: herdr answered ${this.code}, ${this.detail}. crook closed the panes it opened for it${leftOnDisk}. Look at the machine, then start the agent again as a new action.`
  }
}

export class TaskNotDelivered extends Schema.TaggedError<TaskNotDelivered>()('TaskNotDelivered', {
  pane: PaneId,
  code: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `Claude started, but herdr refused the task before typing any of it: ${this.code}, ${this.detail}. Claude is most likely waiting at a dialog, such as the folder trust prompt: open the agent, answer it, and send the task from its chat.`
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
    return `Machine "${this.machine}" did not answer within ${Duration.format(this.timeout)}, and the command may still run. Look at the agent before you send it again.`
  }
}

export const AgentCommandFailure = Schema.Union([
  PaneNotAgent,
  PaneNotCreatedByCrook,
  HerdrRefusedCommand,
  HerdrUnavailable,
  HerdrAnswerUnreadable,
  CommandDeliveryUnknown,
  AskNotPending,
  AskDialogUnreadable,
  AskOptionUnavailable,
  QuestionnaireUnsupported,
  DeclineMessageUndelivered,
  FolderNotFound,
  FolderUnreadable,
  FolderNotCheckout,
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
