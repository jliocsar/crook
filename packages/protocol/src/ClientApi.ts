import * as Rpc from 'effect/rpc/Rpc'
import * as RpcGroup from 'effect/rpc/RpcGroup'
import * as Schema from 'effect/Schema'

import { Command, CommandReceipt } from '@crook/domain/Command'
import { HerdView } from '@crook/domain/HerdView'
import { IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'
import { MachineConnection } from '@crook/domain/Machine'
import { CommandFailure } from '@crook/protocol/Commands'

export class MachineNotInHerd extends Schema.TaggedError<MachineNotInHerd>()('MachineNotInHerd', {
  machine: MachineId,
}) {
  override get message(): string {
    return `The hub knows no machine "${this.machine}": it never connected, or it was forgotten. Pull to resync; a forgotten machine comes back once its agent connects again.`
  }
}

export class MachineStillConnected extends Schema.TaggedError<MachineStillConnected>()(
  'MachineStillConnected',
  { machine: MachineId, connection: MachineConnection },
) {
  override get message(): string {
    return `Machine "${this.machine}" is ${this.connection}, and only an offline machine can be forgotten. Stop its crook agent first, or wait until the hub shows it offline.`
  }
}

export class PaneNotInHerd extends Schema.TaggedError<PaneNotInHerd>()('PaneNotInHerd', {
  machine: MachineId,
  pane: PaneId,
}) {
  override get message(): string {
    return `Machine "${this.machine}" has no agent in pane ${this.pane} in its last published state, so there is nothing to mark seen. The pane most likely closed: pull to resync.`
  }
}

export class HubStorageFailed extends Schema.TaggedError<HubStorageFailed>()('HubStorageFailed', {
  detail: Schema.String,
}) {
  override get message(): string {
    return `The hub could not write to its database, so nothing changed: ${this.detail}. Check the disk and the file at CROOK_HUB_DATABASE_PATH on the hub, then try again.`
  }
}

export const WatchHerd = Rpc.make('WatchHerd', { success: HerdView, stream: true })

export const ForgetMachine = Rpc.make('ForgetMachine', {
  payload: { machine: MachineId },
  error: Schema.Union([MachineNotInHerd, MachineStillConnected, HubStorageFailed]),
})

export const MarkSeen = Rpc.make('MarkSeen', {
  payload: { machine: MachineId, pane: PaneId },
  error: Schema.Union([MachineNotInHerd, PaneNotInHerd, HubStorageFailed]),
})

export const SendCommand = Rpc.make('SendCommand', {
  payload: { machine: MachineId, key: IdempotencyKey, command: Command },
  success: CommandReceipt,
  error: CommandFailure,
})

export class ClientApi extends RpcGroup.make(WatchHerd, ForgetMachine, MarkSeen, SendCommand) {}
