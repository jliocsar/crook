import * as Data from 'effect/Data'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import type * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'

import type { Command, CommandReceipt } from '@crook/domain/Command'
import { findMachine } from '@crook/domain/HerdView'
import type { HerdView } from '@crook/domain/HerdView'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import { agentsIn } from '@crook/domain/MachineState'
import { commandProgress, progressOf } from '@crook/web/atoms/ActionProgress'
import type { CommandProgress } from '@crook/web/atoms/ActionProgress'
import { herdViewAtom } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { HubLink } from '@crook/web/rpc/HubLink'

export class CommandRequest extends Data.Class<{
  readonly machine: MachineId
  readonly command: Command
}> {}

export class PendingActionKey extends Data.Class<{
  readonly key: IdempotencyKey
  readonly machine: MachineId
}> {}

export const sendCommandAtom = Atom.family((key: IdempotencyKey) =>
  hubRuntime
    .fn((request: CommandRequest) =>
      HubLink.use((link) => link.sendCommand(request.machine, key, request.command)),
    )
    .pipe(Atom.keepAlive),
)

const agentsOf = (herd: HerdView, machine: MachineId) =>
  pipe(
    findMachine(herd, machine),
    Option.flatMap((entry) => entry.state),
    agentsIn,
  )

export const pendingAction = (
  result: AsyncResult.AsyncResult<CommandReceipt, { readonly message: string }>,
  herd: Option.Option<HerdView>,
  machine: MachineId,
): CommandProgress =>
  Option.match(herd, {
    onNone: () => progressOf(result, () => false),
    onSome: (view) => commandProgress(result, agentsOf(view, machine)),
  })

export const pendingActionAtom = Atom.family((key: PendingActionKey) =>
  Atom.make((get) => pendingAction(get(sendCommandAtom(key.key)), get(herdViewAtom), key.machine)),
)
