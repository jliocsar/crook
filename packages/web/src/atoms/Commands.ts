import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'

import { isReceiptShown } from '@crook/domain/Command'
import type { Command, CommandReceipt } from '@crook/domain/Command'
import { findMachine } from '@crook/domain/HerdView'
import type { HerdView } from '@crook/domain/HerdView'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import { agentsIn } from '@crook/domain/MachineState'
import { failureMessage } from '@crook/web/atoms/ActionFailure'
import { herdAtom } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { HubLink } from '@crook/web/rpc/HubLink'

export type PendingAction = Data.TaggedEnum<{
  Idle: Record<never, never>
  Sending: Record<never, never>
  Sent: { readonly receipt: CommandReceipt }
  Done: { readonly receipt: CommandReceipt }
  Failed: { readonly message: string }
}>

export const PendingAction = Data.taggedEnum<PendingAction>()

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
      Effect.gen(function* () {
        const link = yield* HubLink

        return yield* link.sendCommand(request.machine, key, request.command)
      }),
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
): PendingAction => {
  if (AsyncResult.isWaiting(result)) {
    return PendingAction.Sending()
  }

  return Option.match(failureMessage(result), {
    onSome: (message) => PendingAction.Failed({ message }),
    onNone: () => {
      if (!AsyncResult.isSuccess(result)) {
        return PendingAction.Idle()
      }

      return Option.exists(herd, (view) => isReceiptShown(result.value, agentsOf(view, machine)))
        ? PendingAction.Done({ receipt: result.value })
        : PendingAction.Sent({ receipt: result.value })
    },
  })
}

export const pendingActionAtom = Atom.family((key: PendingActionKey) =>
  Atom.make((get) =>
    pendingAction(
      get(sendCommandAtom(key.key)),
      Option.map(get(herdAtom), (snapshot) => snapshot.view),
      key.machine,
    ),
  ),
)
