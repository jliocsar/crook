import * as Data from 'effect/Data'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { AskAnswer } from '@crook/domain/Command'
import { CommandFailure, CommandTimedOut, MachineOffline } from '@crook/protocol/Commands'
import { to } from '@crook/web/machine/Machine'
import type { Machine, Step } from '@crook/web/machine/Machine'

export type AnswerFate = Data.TaggedEnum<{
  Delivered: Record<never, never>
  Failed: { readonly failure: CommandFailure }
  NoLongerAsked: Record<never, never>
  AgedOut: Record<never, never>
}>

export type AnswerCommand = Data.TaggedEnum<{
  Poll: Record<never, never>
  Hold: { readonly attempt: number; readonly deadline: number }
  Send: { readonly attempt: number; readonly answer: AskAnswer; readonly link: number }
  Record: { readonly answer: AskAnswer; readonly fate: AnswerFate }
}>

type AnswerStep = Step<AnswerState, AnswerCommand>

export const AnswerState = Schema.TaggedUnion({
  Polling: {},
  Holding: {
    answer: AskAnswer,
    deadline: Schema.Finite,
    attempt: Schema.Int,
    lastFailure: Schema.Option(CommandFailure),
  },
  Sending: { answer: AskAnswer, deadline: Schema.Finite, attempt: Schema.Int },
  SendingWithdrawn: { answer: AskAnswer, attempt: Schema.Int },
  Ended: {},
})
export type AnswerState = typeof AnswerState.Type

export const AnswerEvent = Schema.TaggedUnion({
  HarkAnswered: { answer: AskAnswer, deadline: Schema.Finite },
  HarkClosed: {},
  AskOpen: { attempt: Schema.Int, link: Schema.Int },
  AskMovedOn: { attempt: Schema.Int },
  DeadlinePassed: { attempt: Schema.Int },
  SendFinished: { attempt: Schema.Int, failure: Schema.Option(CommandFailure) },
  Withdrawn: {},
})
export type AnswerEvent = typeof AnswerEvent.Type

export const INCONCLUSIVE_FAILURES = ['MachineOffline', 'CommandTimedOut']
export const POLLING = AnswerState.cases.Polling.make({})
export const ENDED = AnswerState.cases.Ended.make({})
export const HARK_CLOSED = AnswerEvent.cases.HarkClosed.make({})
export const WITHDRAWN = AnswerEvent.cases.Withdrawn.make({})

export const AnswerFate = Data.taggedEnum<AnswerFate>()
export const AnswerCommand = Data.taggedEnum<AnswerCommand>()

const isInconclusive = Schema.is(Schema.Union([MachineOffline, CommandTimedOut]))

const holding = (
  answer: AskAnswer,
  deadline: number,
  attempt: number,
  lastFailure: Option.Option<CommandFailure>,
): AnswerStep => [
  AnswerState.cases.Holding.make({ answer, deadline, attempt, lastFailure }),
  [AnswerCommand.Hold({ attempt, deadline })],
]

const ended = (answer: AskAnswer, fate: AnswerFate): AnswerStep => [
  ENDED,
  [AnswerCommand.Record({ answer, fate })],
]

const fateOfSend = (failure: Option.Option<CommandFailure>): AnswerFate =>
  Option.match(failure, {
    onNone: () => AnswerFate.Delivered(),
    onSome: (found) => AnswerFate.Failed({ failure: found }),
  })

const fateOfLeaving = (lastFailure: Option.Option<CommandFailure>): AnswerFate =>
  Option.match(lastFailure, {
    onNone: () => AnswerFate.NoLongerAsked(),
    onSome: (failure) => AnswerFate.Failed({ failure }),
  })

const afterSend = (state: AnswerState, failure: Option.Option<CommandFailure>): AnswerStep => {
  if (AnswerState.guards.SendingWithdrawn(state)) {
    return ended(state.answer, fateOfSend(failure))
  }

  if (!AnswerState.guards.Sending(state)) {
    return to(state)
  }

  return Option.exists(failure, isInconclusive)
    ? holding(state.answer, state.deadline, state.attempt + 1, failure)
    : ended(state.answer, fateOfSend(failure))
}

const isCurrentSend = (state: AnswerState, attempt: number) =>
  (AnswerState.guards.Sending(state) || AnswerState.guards.SendingWithdrawn(state)) &&
  state.attempt === attempt

const whileHolding = (
  state: AnswerState,
  attempt: number,
  step: (held: typeof AnswerState.cases.Holding.Type) => AnswerStep,
): AnswerStep =>
  AnswerState.guards.Holding(state) && state.attempt === attempt ? step(state) : to(state)

const afterWithdrawn = (state: AnswerState): AnswerStep =>
  Match.value(state).pipe(
    Match.withReturnType<AnswerStep>(),
    Match.tagsExhaustive({
      Polling: () => to(ENDED),
      Holding: (held) => ended(held.answer, fateOfLeaving(held.lastFailure)),
      Sending: (sending) =>
        to(
          AnswerState.cases.SendingWithdrawn.make({
            answer: sending.answer,
            attempt: sending.attempt,
          }),
        ),
      SendingWithdrawn: to,
      Ended: to,
    }),
  )

const answerTransition = (state: AnswerState, event: AnswerEvent): AnswerStep =>
  Match.value(event).pipe(
    Match.withReturnType<AnswerStep>(),
    Match.tagsExhaustive({
      HarkAnswered: ({ answer, deadline }) =>
        AnswerState.guards.Polling(state) ? holding(answer, deadline, 0, Option.none()) : to(state),
      HarkClosed: () => to(AnswerState.guards.Polling(state) ? ENDED : state),
      AskOpen: ({ attempt, link }) =>
        whileHolding(state, attempt, ({ answer, deadline }) => [
          AnswerState.cases.Sending.make({ answer, deadline, attempt }),
          [AnswerCommand.Send({ attempt, answer, link })],
        ]),
      AskMovedOn: ({ attempt }) =>
        whileHolding(state, attempt, ({ answer, lastFailure }) =>
          ended(answer, fateOfLeaving(lastFailure)),
        ),
      DeadlinePassed: ({ attempt }) =>
        whileHolding(state, attempt, ({ answer }) => ended(answer, AnswerFate.AgedOut())),
      SendFinished: ({ attempt, failure }) =>
        isCurrentSend(state, attempt) ? afterSend(state, failure) : to(state),
      Withdrawn: () => afterWithdrawn(state),
    }),
  )

export const approvalAnswerMachine: Machine<AnswerState, AnswerEvent, AnswerCommand> = {
  name: 'approval-answer',
  states: AnswerState,
  events: AnswerEvent,
  initial: POLLING,
  transition: answerTransition,
}
