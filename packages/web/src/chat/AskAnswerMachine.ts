import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import type { AgentRow } from '@crook/domain/AgentRow'
import { askDialog } from '@crook/domain/Ask'
import type { Ask } from '@crook/domain/Ask'
import { AskAnswer } from '@crook/domain/Command'
import { IdempotencyKey } from '@crook/domain/Ids'
import { AskNotPending } from '@crook/protocol/Commands'
import { to } from '@crook/state-machine/Machine'
import type { Machine, Step } from '@crook/state-machine/Machine'
import { ActionProgress, UNCONFIRMED_NOTE } from '@crook/web/atoms/ActionProgress'
import type { CommandAction } from '@crook/web/chat/CommandAction'

type HeardAction = Pick<CommandAction, 'state' | 'refusal' | 'key'>

const ASKING_SEPARATOR = ' '
const SENT_ANSWER = { asking: Schema.String, key: IdempotencyKey, answer: AskAnswer }

export const AskAnswerState = Schema.TaggedUnion({
  Open: {},
  Answering: SENT_ANSWER,
  Answered: SENT_ANSWER,
  AlreadyAnswered: SENT_ANSWER,
  Refused: { ...SENT_ANSWER, message: Schema.String },
})
export type AskAnswerState = typeof AskAnswerState.Type

export const AskAnswerEvent = Schema.TaggedUnion({
  AskShown: { asking: Schema.String },
  AnswerPressed: SENT_ANSWER,
  Delivered: { key: IdempotencyKey },
  NotPending: { key: IdempotencyKey },
  AnswerRefused: { key: IdempotencyKey, message: Schema.String },
})
export type AskAnswerEvent = typeof AskAnswerEvent.Type

export type AnswerHeard =
  | typeof AskAnswerEvent.cases.Delivered.Type
  | typeof AskAnswerEvent.cases.NotPending.Type
  | typeof AskAnswerEvent.cases.AnswerRefused.Type

const OPEN = AskAnswerState.cases.Open.make({})

export const askShown = (asking: string) => AskAnswerEvent.cases.AskShown.make({ asking })
export const answerPressed = (asking: string, key: IdempotencyKey, answer: AskAnswer) =>
  AskAnswerEvent.cases.AnswerPressed.make({ asking, key, answer })
export const delivered = (key: IdempotencyKey) => AskAnswerEvent.cases.Delivered.make({ key })
export const notPending = (key: IdempotencyKey) => AskAnswerEvent.cases.NotPending.make({ key })
export const answerRefused = (key: IdempotencyKey, message: string) =>
  AskAnswerEvent.cases.AnswerRefused.make({ key, message })

const isAlreadyAnswered = Schema.is(AskNotPending)

const canBeDelivered = AskAnswerState.isAnyOf(['Answering', 'Refused'])

const canBeRefused = AskAnswerState.isAnyOf(['Answering', 'Answered'])

export const isAnswerUnderway = AskAnswerState.guards.Answering

export const askingOf = (row: AgentRow, ask: Ask): string =>
  [row.terminal, row.stateChangeSeq, ask.id, Option.getOrElse(askDialog(ask), () => '')].join(
    ASKING_SEPARATOR,
  )

export const answerInFlight = (state: AskAnswerState): Option.Option<AskAnswer> =>
  Option.map(Option.liftPredicate(state, isAnswerUnderway), (answering) => answering.answer)

export const answerHeard = (action: HeardAction): Option.Option<AnswerHeard> =>
  ActionProgress.$match(action.state, {
    Idle: () => Option.none(),
    Sending: () => Option.none(),
    Sent: () => Option.some<AnswerHeard>(delivered(action.key)),
    Done: () => Option.some<AnswerHeard>(delivered(action.key)),
    Unconfirmed: () => Option.some<AnswerHeard>(answerRefused(action.key, UNCONFIRMED_NOTE)),
    Failed: ({ message }) =>
      Option.some<AnswerHeard>(
        Option.exists(action.refusal, isAlreadyAnswered)
          ? notPending(action.key)
          : answerRefused(action.key, message),
      ),
  })

const askAnswerTransition = (state: AskAnswerState, event: AskAnswerEvent): Step<AskAnswerState> =>
  Match.value(event).pipe(
    Match.withReturnType<Step<AskAnswerState>>(),
    Match.tagsExhaustive({
      AskShown: ({ asking }) =>
        to(!AskAnswerState.guards.Open(state) && state.asking !== asking ? OPEN : state),
      AnswerPressed: ({ asking, key, answer }) =>
        to(AskAnswerState.cases.Answering.make({ asking, key, answer })),
      Delivered: ({ key }) =>
        to(
          canBeDelivered(state) && state.key === key
            ? AskAnswerState.cases.Answered.make({
                asking: state.asking,
                key,
                answer: state.answer,
              })
            : state,
        ),
      NotPending: ({ key }) =>
        to(
          AskAnswerState.guards.Answering(state) && state.key === key
            ? AskAnswerState.cases.AlreadyAnswered.make({
                asking: state.asking,
                key,
                answer: state.answer,
              })
            : state,
        ),
      AnswerRefused: ({ key, message }) =>
        to(
          canBeRefused(state) && state.key === key
            ? AskAnswerState.cases.Refused.make({
                asking: state.asking,
                key,
                answer: state.answer,
                message,
              })
            : state,
        ),
    }),
  )

export const askAnswerMachine: Machine<AskAnswerState, AskAnswerEvent> = {
  name: 'ask-answer',
  states: AskAnswerState,
  events: AskAnswerEvent,
  initial: OPEN,
  transition: askAnswerTransition,
}
