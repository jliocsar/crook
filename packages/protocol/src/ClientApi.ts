import * as Rpc from 'effect/rpc/Rpc'
import * as RpcGroup from 'effect/rpc/RpcGroup'

import { HerdView } from '@crook/domain/HerdView'

export const WatchHerd = Rpc.make('WatchHerd', { success: HerdView, stream: true })

export class ClientApi extends RpcGroup.make(WatchHerd) {}
