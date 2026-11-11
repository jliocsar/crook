import * as Duration from 'effect/Duration'
import * as Match from 'effect/Match'
import * as Rpc from 'effect/rpc/Rpc'
import * as RpcGroup from 'effect/rpc/RpcGroup'
import * as Schema from 'effect/Schema'

import type { Command } from '@crook/domain/Command'
import { MachineId } from '@crook/domain/Ids'
import { MachineState } from '@crook/domain/MachineState'
import { CommandId, CommandResult, RoutedCommand } from '@crook/protocol/Commands'
import { LINK_PING_INTERVAL } from '@crook/protocol/LinkTiming'
import {
  TranscriptDemand,
  TranscriptOutOfStep,
  TranscriptUpdate,
  TranscriptWatchId,
} from '@crook/protocol/Transcripts'

const PROMPT_START_WINDOW = Duration.seconds(5)
const SLOWEST_MEASURED_SHELL_READY = Duration.millis(708)

export const COMMAND_TIMEOUT = LINK_PING_INTERVAL
export const AGENT_READY_TIMEOUT = Duration.seconds(30)
export const SLOWEST_MEASURED_PROMPT_HOOKS = Duration.millis(58)
export const SHELL_READY_TIMEOUT = Duration.times(SLOWEST_MEASURED_SHELL_READY, 10)
export const PANE_BUSY_RETRY_LIMIT = Duration.times(SLOWEST_MEASURED_PROMPT_HOOKS, 10)
export const SHELL_START_WAIT = Duration.sum(SHELL_READY_TIMEOUT, PANE_BUSY_RETRY_LIMIT)
export const AGENT_START_WAIT = Duration.sum(SHELL_START_WAIT, AGENT_READY_TIMEOUT)
export const LAUNCH_HERDR_WAIT = Duration.sum(AGENT_START_WAIT, PROMPT_START_WINDOW)
export const LAUNCH_COMMAND_TIMEOUT = Duration.sum(LAUNCH_HERDR_WAIT, COMMAND_TIMEOUT)
export const ATTACHMENT_FETCH_TIMEOUT = Duration.seconds(60)
export const ATTACHMENT_COMMAND_TIMEOUT = Duration.sum(ATTACHMENT_FETCH_TIMEOUT, COMMAND_TIMEOUT)

export const commandTimeout = (command: Command): Duration.Duration =>
  Match.value(command).pipe(
    Match.tagsExhaustive({
      Prompt: (prompt) =>
        prompt.attachments.length === 0 ? COMMAND_TIMEOUT : ATTACHMENT_COMMAND_TIMEOUT,
      SendKeys: () => COMMAND_TIMEOUT,
      RenameAgent: () => COMMAND_TIMEOUT,
      ClosePane: () => COMMAND_TIMEOUT,
      AnswerAsk: () => COMMAND_TIMEOUT,
      StartAgent: () => LAUNCH_COMMAND_TIMEOUT,
      CreateWorktree: () => LAUNCH_COMMAND_TIMEOUT,
    }),
  )

export class MachineIdMismatch extends Schema.TaggedError<MachineIdMismatch>()(
  'MachineIdMismatch',
  {
    connectedMachine: MachineId,
    publishedMachine: MachineId,
  },
) {
  override get message(): string {
    return `This connection is authenticated as machine "${this.connectedMachine}" but published state for "${this.publishedMachine}". Check the agent's exe.dev token: the hub takes the machine id from the token, never from the payload.`
  }
}

export class Hello extends Schema.Class<Hello>('Hello')({
  agentVersion: Schema.String,
  label: Schema.OptionFromNullOr(Schema.NonEmptyString),
}) {}

export const Attach = Rpc.make('Attach', {
  payload: { hello: Hello },
  success: RoutedCommand,
  stream: true,
})

export const PublishState = Rpc.make('PublishState', {
  payload: { state: MachineState },
  error: MachineIdMismatch,
})

export const CompleteCommand = Rpc.make('CompleteCommand', {
  payload: { id: CommandId, result: CommandResult },
})

export const TranscriptDemands = Rpc.make('TranscriptDemands', {
  success: TranscriptDemand,
  stream: true,
})

export const PublishTranscript = Rpc.make('PublishTranscript', {
  payload: { watch: TranscriptWatchId, update: TranscriptUpdate },
  error: TranscriptOutOfStep,
})

export const PublishTranscriptBatch = Rpc.make('PublishTranscriptBatch', {
  payload: { watch: TranscriptWatchId, updates: Schema.NonEmptyArray(TranscriptUpdate) },
  error: TranscriptOutOfStep,
})

export class AgentLink extends RpcGroup.make(
  Attach,
  PublishState,
  CompleteCommand,
  TranscriptDemands,
  PublishTranscript,
  PublishTranscriptBatch,
) {}
