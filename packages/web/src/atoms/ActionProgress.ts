import * as Data from 'effect/Data'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Schema from 'effect/Schema'

import type { AgentRow } from '@crook/domain/AgentRow'
import { isReceiptShown } from '@crook/domain/Command'
import type { CommandReceipt } from '@crook/domain/Command'
import { PaneNotCreatedByCrook } from '@crook/protocol/Commands'
import { failureMessage, settledError } from '@crook/web/atoms/ActionFailure'

export type ActionProgress<Receipt> = Data.TaggedEnum<{
  Idle: Record<never, never>
  Sending: Record<never, never>
  Sent: { readonly receipt: Receipt }
  Done: { readonly receipt: Receipt }
  Failed: {
    readonly message: string
    readonly asksConfirmation: boolean
  }
}>

export type CommandProgress = ActionProgress<CommandReceipt>

interface ActionProgressDefinition extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: ActionProgress<this['A']>
}

export const ActionProgress = Data.taggedEnum<ActionProgressDefinition>()

const asksConfirmation = Schema.is(PaneNotCreatedByCrook)

export const progressOf = <Receipt, Failure extends { readonly message: string }>(
  result: AsyncResult.AsyncResult<Receipt, Failure>,
  shown: (receipt: Receipt) => boolean,
): ActionProgress<Receipt> => {
  if (AsyncResult.isWaiting(result)) {
    return ActionProgress.Sending()
  }

  return Option.match(failureMessage(result), {
    onSome: (message) =>
      ActionProgress.Failed({
        message,
        asksConfirmation: Option.exists(settledError(result), asksConfirmation),
      }),
    onNone: () => {
      if (!AsyncResult.isSuccess(result)) {
        return ActionProgress.Idle()
      }

      return shown(result.value)
        ? ActionProgress.Done({ receipt: result.value })
        : ActionProgress.Sent({ receipt: result.value })
    },
  })
}

export const commandProgress = <Failure extends { readonly message: string }>(
  result: AsyncResult.AsyncResult<CommandReceipt, Failure>,
  agents: readonly AgentRow[],
): CommandProgress => progressOf(result, (receipt) => isReceiptShown(receipt, agents))
