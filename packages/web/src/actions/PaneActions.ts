import * as Data from 'effect/Data'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { type AgentRow, agentTitle } from '@crook/domain/AgentRow'
import { PaneLabel } from '@crook/domain/Command'
import type { HerdMachine } from '@crook/domain/HerdView'
import type { PaneId } from '@crook/domain/Ids'
import { panePresence } from '@crook/domain/MachineState'
import type { PanePresence } from '@crook/domain/MachineState'
import { remembersOutcome, settledError } from '@crook/web/atoms/ActionFailure'
import type { SendCommandFailure } from '@crook/web/atoms/ActionFailure'
import {
  ActionProgress,
  failureMessageOf,
  unconfirmedNoteOf,
  isDone,
  isFailed,
  isIdle,
  progressOf,
} from '@crook/web/atoms/ActionProgress'
import type { HubCallFailed, SetPinnedRefused } from '@crook/web/rpc/HubConnection'
import type { HubNotConnected } from '@crook/web/rpc/HubLink'

export type SetPinnedFailure = SetPinnedRefused | HubCallFailed | HubNotConnected

export type SheetOutcome = Data.TaggedEnum<{
  Stay: Record<never, never>
  Finished: Record<never, never>
  Closed: Record<never, never>
  Ended: { readonly notice: string }
}>

export const PANE_CLOSED_NOTICE = 'Pane closed'
export const CLAUDE_EXITED_NOTICE = 'Claude exited'

export const SheetOutcome = Data.taggedEnum<SheetOutcome>()

export class InvalidPaneLabel extends Schema.TaggedError<InvalidPaneLabel>()(
  'InvalidPaneLabel',
  {},
) {
  override get message(): string {
    return "A name can't hold control characters such as tabs or line breaks. Type it on one line."
  }
}

export const pinProgress = (
  result: AsyncResult.AsyncResult<boolean, SetPinnedFailure>,
  pinnedNow: boolean,
): ActionProgress<boolean> => progressOf(result, (pinned) => pinned === pinnedNow)

export const isInFlightOrDone = ActionProgress.$match({
  Idle: () => false,
  Sending: () => true,
  Sent: () => true,
  Unconfirmed: () => false,
  Done: () => true,
  Failed: () => false,
})

const isSettled = (progress: ActionProgress<unknown>): boolean =>
  isIdle(progress) || isDone(progress)

export const isConfirmationAsked = (progress: ActionProgress<unknown>): boolean =>
  Option.exists(Option.liftPredicate(progress, isFailed), (failed) => failed.asksConfirmation)

export const failureOf = (progress: ActionProgress<unknown>): Option.Option<string> =>
  Option.orElse(
    Option.filter(failureMessageOf(progress), () => !isConfirmationAsked(progress)),
    () => unconfirmedNoteOf(progress),
  )

export const closeNeedsConfirmation = (
  row: AgentRow,
  close: ActionProgress<unknown>,
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
  readonly rename: ActionProgress<unknown>
  readonly close: ActionProgress<unknown>
  readonly pin: ActionProgress<unknown>
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
