import * as Data from 'effect/Data'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { type AgentRow, agentTitle } from '@crook/domain/AgentRow'
import { isReceiptShown, PaneLabel } from '@crook/domain/Command'
import type { CommandReceipt } from '@crook/domain/Command'
import type { HerdMachine } from '@crook/domain/HerdView'
import type { PaneId } from '@crook/domain/Ids'
import { panePresence } from '@crook/domain/MachineState'
import type { PanePresence } from '@crook/domain/MachineState'
import { failureMessage, remembersOutcome, settledError } from '@crook/web/atoms/ActionFailure'
import type { SendCommandFailure } from '@crook/web/atoms/ActionFailure'
import type { HubCallFailed, SetPinnedRefused } from '@crook/web/rpc/HubConnection'
import type { HubNotConnected } from '@crook/web/rpc/HubLink'

export type SetPinnedFailure = SetPinnedRefused | HubCallFailed | HubNotConnected

export type ActionProgress = Data.TaggedEnum<{
  Idle: Record<never, never>
  Sending: Record<never, never>
  Sent: Record<never, never>
  Done: Record<never, never>
  Failed: {
    readonly message: string
    readonly asksConfirmation: boolean
  }
}>

export type SheetOutcome = Data.TaggedEnum<{
  Stay: Record<never, never>
  Finished: Record<never, never>
  Closed: Record<never, never>
  Ended: { readonly notice: string }
}>

export const PANE_CLOSED_NOTICE = 'Pane closed'
export const CLAUDE_EXITED_NOTICE = 'Claude exited'

export const ActionProgress = Data.taggedEnum<ActionProgress>()

export const SheetOutcome = Data.taggedEnum<SheetOutcome>()

export class InvalidPaneLabel extends Schema.TaggedError<InvalidPaneLabel>()(
  'InvalidPaneLabel',
  {},
) {
  override get message(): string {
    return "A name can't hold control characters such as tabs or line breaks. Type it on one line."
  }
}

const IDLE = ActionProgress.Idle()
const SENDING = ActionProgress.Sending()
const SENT = ActionProgress.Sent()
const DONE = ActionProgress.Done()

const asksConfirmation = (error: SendCommandFailure | SetPinnedFailure): boolean =>
  Match.value(error).pipe(
    Match.tag('PaneNotCreatedByCrook', () => true),
    Match.orElse(() => false),
  )

const progressOf = <Success, Failure extends SendCommandFailure | SetPinnedFailure>(
  result: AsyncResult.AsyncResult<Success, Failure>,
  shown: (success: Success) => boolean,
): ActionProgress => {
  if (AsyncResult.isWaiting(result)) {
    return SENDING
  }

  return Option.match(failureMessage(result), {
    onSome: (message) =>
      ActionProgress.Failed({
        message,
        asksConfirmation: Option.exists(settledError(result), asksConfirmation),
      }),
    onNone: () => {
      if (!AsyncResult.isSuccess(result)) {
        return IDLE
      }

      return shown(result.value) ? DONE : SENT
    },
  })
}

export const commandProgress = (
  result: AsyncResult.AsyncResult<CommandReceipt, SendCommandFailure>,
  agents: readonly AgentRow[],
): ActionProgress => progressOf(result, (receipt) => isReceiptShown(receipt, agents))

export const pinProgress = (
  result: AsyncResult.AsyncResult<boolean, SetPinnedFailure>,
  pinnedNow: boolean,
): ActionProgress => progressOf(result, (pinned) => pinned === pinnedNow)

export const isInFlightOrDone = ActionProgress.$match({
  Idle: () => false,
  Sending: () => true,
  Sent: () => true,
  Done: () => true,
  Failed: () => false,
})

const isDone = ActionProgress.$is('Done')

const isIdle = ActionProgress.$is('Idle')

const isSettled = (progress: ActionProgress): boolean => isIdle(progress) || isDone(progress)

export const failureOf = (progress: ActionProgress): Option.Option<string> =>
  ActionProgress.$match(progress, {
    Idle: () => Option.none(),
    Sending: () => Option.none(),
    Sent: () => Option.none(),
    Done: () => Option.none(),
    Failed: ({ message, asksConfirmation: confirming }) =>
      confirming ? Option.none() : Option.some(message),
  })

export const isConfirmationAsked = (progress: ActionProgress): boolean =>
  ActionProgress.$match(progress, {
    Idle: () => false,
    Sending: () => false,
    Sent: () => false,
    Done: () => false,
    Failed: ({ asksConfirmation: confirming }) => confirming,
  })

export const closeNeedsConfirmation = (
  row: AgentRow,
  close: ActionProgress,
  lastClose: Option.Option<{ readonly confirmed: boolean }>,
): boolean =>
  !row.createdByCrook ||
  isConfirmationAsked(close) ||
  Option.exists(lastClose, (attempt) => attempt.confirmed)

export const isRetriableFailure = <Success, Failure extends SendCommandFailure>(
  result: AsyncResult.AsyncResult<Success, Failure>,
): boolean => Option.exists(settledError(result), (error) => !remembersOutcome(error))

export const isCommandUnderway = <Success, Failure extends SendCommandFailure>(
  result: AsyncResult.AsyncResult<Success, Failure>,
): boolean => AsyncResult.isWaiting(result) || AsyncResult.isSuccess(result)

export const labelFromInput = (
  input: string,
): Result.Result<Option.Option<string>, InvalidPaneLabel> =>
  pipe(
    Option.liftPredicate(input.trim(), Str.isNonEmpty),
    Option.match({
      onNone: () => Result.succeed(Option.none<string>()),
      onSome: (trimmed) =>
        pipe(
          Schema.decodeResult(PaneLabel)(trimmed),
          Result.map(Option.some),
          Result.mapError(() => new InvalidPaneLabel()),
        ),
    }),
  )

export const keepsName = (row: AgentRow, label: Option.Option<string>): boolean =>
  Option.match(label, {
    onNone: () => Option.isNone(row.label),
    onSome: (name) => name === agentTitle(row),
  })

const ENDED_NOTICE = {
  agent: Option.none(),
  noAgent: Option.some(CLAUDE_EXITED_NOTICE),
  gone: Option.some(PANE_CLOSED_NOTICE),
} satisfies Record<PanePresence, Option.Option<string>>

export const endedNotice = (herdMachine: Option.Option<HerdMachine>, pane: PaneId) =>
  pipe(
    Option.flatMap(herdMachine, (entry) => entry.state),
    Option.flatMap((state) => ENDED_NOTICE[panePresence(state, pane)]),
  )

export const sheetOutcome = (sheet: {
  readonly herdMachine: Option.Option<HerdMachine>
  readonly pane: PaneId
  readonly rename: ActionProgress
  readonly close: ActionProgress
  readonly pin: ActionProgress
}): SheetOutcome => {
  if (isDone(sheet.close)) {
    return SheetOutcome.Closed()
  }

  return pipe(
    endedNotice(sheet.herdMachine, sheet.pane),
    Option.filter(() => !isInFlightOrDone(sheet.close)),
    Option.match({
      onSome: (notice) => SheetOutcome.Ended({ notice }),
      onNone: () =>
        isIdle(sheet.close) &&
        isSettled(sheet.rename) &&
        isSettled(sheet.pin) &&
        (isDone(sheet.rename) || isDone(sheet.pin))
          ? SheetOutcome.Finished()
          : SheetOutcome.Stay(),
    }),
  )
}
