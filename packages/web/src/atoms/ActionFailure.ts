import * as Cause from 'effect/Cause'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'

const UNEXPECTED_FAILURE_MESSAGE =
  'Something inside crook failed without saying why. Reload crook and try again.'

export const settledFailure = <Success, Failure extends { readonly message: string }>(
  result: AsyncResult.AsyncResult<Success, Failure>,
): Option.Option<Cause.Cause<Failure>> =>
  pipe(
    Option.liftPredicate(result, (current) => !AsyncResult.isWaiting(current)),
    Option.flatMap(AsyncResult.cause),
    Option.filter((cause) => !Cause.hasInterruptsOnly(cause)),
  )

export const failureMessage = <Success, Failure extends { readonly message: string }>(
  result: AsyncResult.AsyncResult<Success, Failure>,
): Option.Option<string> =>
  Option.map(settledFailure(result), (cause) =>
    Option.match(Cause.findErrorOption(cause), {
      onNone: () => UNEXPECTED_FAILURE_MESSAGE,
      onSome: (error) => error.message,
    }),
  )
