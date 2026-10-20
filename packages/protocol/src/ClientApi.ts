import * as Rpc from 'effect/rpc/Rpc'
import * as RpcGroup from 'effect/rpc/RpcGroup'

import { Command, CommandReceipt } from '@crook/domain/Command'
import { HerdView } from '@crook/domain/HerdView'
import { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import { CommandFailure } from '@crook/protocol/Commands'

export const WatchHerd = Rpc.make('WatchHerd', { success: HerdView, stream: true })

export const SendCommand = Rpc.make('SendCommand', {
  payload: { machine: MachineId, key: IdempotencyKey, command: Command },
  success: CommandReceipt,
  error: CommandFailure,
})

export class ClientApi extends RpcGroup.make(WatchHerd, SendCommand) {}
