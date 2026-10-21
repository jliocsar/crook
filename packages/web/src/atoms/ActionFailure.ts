import * as Cause from 'effect/Cause'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'

import type { CommandFailure } from '@crook/protocol/Commands'
import type { HubCallFailed } from '@crook/web/rpc/HubConnection'
import type { HubNotConnected } from '@crook/web/rpc/HubLink'

export type SendCommandFailure = CommandFailure | HubCallFailed | HubNotConnected

export const UNEXPECTED_FAILURE_MESSAGE =
  'Something inside crook failed without saying why. Reload crook and try again.'

export const settledFailure = <Success, Failure>(
  result: AsyncResult.AsyncResult<Success, Failure>,
): Option.Option<Cause.Cause<Failure>> =>
  pipe(
    Option.liftPredicate(result, (current) => !AsyncResult.isWaiting(current)),
    Option.flatMap(AsyncResult.cause),
    Option.filter((cause) => !Cause.hasInterruptsOnly(cause)),
  )

export const settledError = <Success, Failure>(
  result: AsyncResult.AsyncResult<Success, Failure>,
): Option.Option<Failure> => Option.flatMap(settledFailure(result), Cause.findErrorOption)

export const failureMessage = <Success, Failure extends { readonly message: string }>(
  result: AsyncResult.AsyncResult<Success, Failure>,
): Option.Option<string> =>
  Option.map(settledFailure(result), (cause) =>
    Option.match(Cause.findErrorOption(cause), {
      onNone: () => UNEXPECTED_FAILURE_MESSAGE,
      onSome: (error) => error.message,
    }),
  )

export const remembersOutcome = (failure: SendCommandFailure): boolean =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      AgentNotStarted: () => true,
      TaskNotDelivered: () => true,
      CommandDeliveryUnknown: () => true,
      DeclineMessageUndelivered: () => true,
      FolderNotFound: () => false,
      FolderUnreadable: () => false,
      FolderNotCheckout: () => false,
      HerdrRefusedCommand: () => false,
      HerdrUnavailable: () => false,
      HerdrAnswerUnreadable: () => false,
      PaneNotAgent: () => false,
      PaneNotCreatedByCrook: () => false,
      AskNotPending: () => false,
      AskDialogUnreadable: () => false,
      AskOptionUnavailable: () => false,
      QuestionnaireUnsupported: () => false,
      MachineOffline: () => false,
      CommandTimedOut: () => false,
      HubConnectionLost: () => false,
      HubCallDefected: () => false,
      HubNotConnected: () => false,
    }),
  )
