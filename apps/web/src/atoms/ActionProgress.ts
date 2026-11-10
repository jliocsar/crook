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
  Unconfirmed: { readonly receipt: Receipt }
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

export const isIdle = ActionProgress.$is('Idle')

export const isSending = ActionProgress.$is('Sending')

export const isSent = ActionProgress.$is('Sent')

export const isUnconfirmed = ActionProgress.$is('Unconfirmed')

export const isDone = ActionProgress.$is('Done')

export const isFailed = ActionProgress.$is('Failed')

export const UNCONFIRMED_NOTE =
  'crook sent this, but the machine has not shown it yet. It may still land, so try again only if nothing changes.'

const asksConfirmation = Schema.is(PaneNotCreatedByCrook)

export const unconfirmedNoteOf = (progress: ActionProgress<unknown>): Option.Option<string> =>
  isUnconfirmed(progress) ? Option.some(UNCONFIRMED_NOTE) : Option.none()

export const failureMessageOf = (progress: ActionProgress<unknown>): Option.Option<string> =>
  Option.map(Option.liftPredicate(progress, isFailed), (failed) => failed.message)

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
