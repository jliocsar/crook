import * as Duration from 'effect/Duration'
import * as Rpc from 'effect/rpc/Rpc'
import * as RpcGroup from 'effect/rpc/RpcGroup'
import * as Schema from 'effect/Schema'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { MachineId } from '@crook/domain/Ids'
import { MachineState } from '@crook/domain/MachineState'

export const AGENT_PING_INTERVAL = Duration.seconds(5)

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
  agentVersion: CrookVersion,
  label: Schema.OptionFromNullOr(Schema.NonEmptyString),
}) {}

export const Attach = Rpc.make('Attach', {
  payload: { hello: Hello },
  success: Schema.Never,
  stream: true,
})

export const PublishState = Rpc.make('PublishState', {
  payload: { state: MachineState },
  error: MachineIdMismatch,
})

export class AgentLink extends RpcGroup.make(Attach, PublishState) {}
