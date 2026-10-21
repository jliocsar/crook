import * as Cause from 'effect/Cause'
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
import type { CommandFailure } from '@crook/protocol/Commands'
import type { HubCallFailed, SetPinnedRefused } from '@crook/web/rpc/HubConnection'
import type { HubNotConnected } from '@crook/web/rpc/HubLink'

export type SendCommandFailure = CommandFailure | HubCallFailed | HubNotConnected

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

export interface SheetProgress {
  readonly herdMachine: Option.Option<HerdMachine>
  readonly pane: PaneId
  readonly rename: ActionProgress
  readonly close: ActionProgress
  readonly pin: ActionProgress
}

export const PANE_CLOSED_NOTICE = 'Pane closed'
export const CLAUDE_EXITED_NOTICE = 'Claude exited'

export const UNEXPLAINED_FAILURE =
  'The action stopped without saying why, so crook cannot tell whether it reached the machine. Look at the agent, then try again.'

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

export const keepsKey = (error: SendCommandFailure | SetPinnedFailure): boolean =>
  Match.value(error).pipe(
    Match.tags({
      CommandTimedOut: () => true,
      HubConnectionLost: () => true,
      HubCallDefected: () => true,
    }),
    Match.orElse(() => false),
  )

export const asksConfirmation = (error: SendCommandFailure | SetPinnedFailure): boolean =>
  Match.value(error).pipe(
    Match.tag('PaneNotCreatedByCrook', () => true),
    Match.orElse(() => false),
  )

const keepsKeyAfter = <Failure extends SendCommandFailure | SetPinnedFailure>(
  cause: Cause.Cause<Failure>,
): boolean =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => !Cause.hasInterruptsOnly(cause),
    onSome: keepsKey,
  })

const failed = <Failure extends SendCommandFailure | SetPinnedFailure>(
  cause: Cause.Cause<Failure>,
): ActionProgress =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () =>
      Cause.hasInterruptsOnly(cause)
        ? IDLE
        : ActionProgress.Failed({ message: UNEXPLAINED_FAILURE, asksConfirmation: false }),
    onSome: (error) =>
      ActionProgress.Failed({ message: error.message, asksConfirmation: asksConfirmation(error) }),
  })

const progressOf = <Success, Failure extends SendCommandFailure | SetPinnedFailure>(
  result: AsyncResult.AsyncResult<Success, Failure>,
  shown: (success: Success) => boolean,
): ActionProgress => {
  if (AsyncResult.isWaiting(result)) {
    return SENDING
  }

  return AsyncResult.match(result, {
    onInitial: () => IDLE,
    onFailure: ({ cause }) => failed(cause),
    onSuccess: ({ value }) => (shown(value) ? DONE : SENT),
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

export const isUnderway = ActionProgress.$match({
  Idle: () => false,
  Sending: () => true,
  Sent: () => true,
  Done: () => true,
  Failed: () => false,
})

export const isDone = ActionProgress.$is('Done')

export const isIdle = ActionProgress.$is('Idle')

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

export const isRetriableFailure = <Success, Failure extends SendCommandFailure>(
  result: AsyncResult.AsyncResult<Success, Failure>,
): boolean =>
  !AsyncResult.isWaiting(result) && AsyncResult.isFailure(result) && keepsKeyAfter(result.cause)

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

export const sheetOutcome = (sheet: SheetProgress): SheetOutcome => {
  if (isDone(sheet.close)) {
    return SheetOutcome.Closed()
  }

  return pipe(
    endedNotice(sheet.herdMachine, sheet.pane),
    Option.filter(() => !isUnderway(sheet.close)),
    Option.match({
      onSome: (notice) => SheetOutcome.Ended({ notice }),
      onNone: () =>
        isIdle(sheet.close) && (isDone(sheet.rename) || isDone(sheet.pin))
          ? SheetOutcome.Finished()
          : SheetOutcome.Stay(),
    }),
  )
}
