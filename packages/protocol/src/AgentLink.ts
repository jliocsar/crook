import * as Duration from 'effect/Duration'
import * as Rpc from 'effect/rpc/Rpc'
import * as RpcGroup from 'effect/rpc/RpcGroup'
import * as Schema from 'effect/Schema'

import { MachineId } from '@crook/domain/Ids'
import { MachineState } from '@crook/domain/MachineState'
import { CommandId, CommandResult, RoutedCommand } from '@crook/protocol/Commands'
import {
  TranscriptDemand,
  TranscriptOutOfStep,
  TranscriptUpdate,
  TranscriptWatchId,
} from '@crook/protocol/Transcripts'

export const AGENT_PING_INTERVAL = Duration.seconds(5)
export const AGENT_SOCKET_OPEN_TIMEOUT = Duration.seconds(10)
export const COMMAND_TIMEOUT = AGENT_PING_INTERVAL

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

export class AgentLink extends RpcGroup.make(
  Attach,
  PublishState,
  CompleteCommand,
  TranscriptDemands,
  PublishTranscript,
) {}
