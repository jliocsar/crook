import { caseName } from '@crook/state-machine/Machine'
import type { WalkSpec } from '@crook/state-machine/Walk'
import { Approve } from '@crook/domain/Command'
import { IdempotencyKey } from '@crook/domain/Ids'
import {
  answerPressed,
  answerRefused,
  askAnswerMachine,
  AskAnswerEvent,
  AskAnswerState,
  askShown,
  delivered,
  notPending,
} from '@crook/web/chat/AskAnswerMachine'

const AN_ASKING = 'term_1 1 toolu_1 dialog'
const SAME_DIALOG_ASKED_AGAIN = 'term_1 3 toolu_1 dialog'
const REFUSAL = 'Refused.'
const AN_ANSWER = IdempotencyKey.make('an answer')
const A_STALE_KEY = IdempotencyKey.make('a stale key')

const settlesAnAnswer = AskAnswerEvent.isAnyOf(['Delivered', 'NotPending', 'AnswerRefused'])

export const askAnswerWalk: WalkSpec<AskAnswerState, AskAnswerEvent, never> = {
  machine: askAnswerMachine,
  events: () => [
    askShown(AN_ASKING),
    askShown(SAME_DIALOG_ASKED_AGAIN),
    answerPressed(AN_ASKING, AN_ANSWER, new Approve()),
    delivered(AN_ANSWER),
    delivered(A_STALE_KEY),
    notPending(AN_ANSWER),
    notPending(A_STALE_KEY),
    answerRefused(AN_ANSWER, REFUSAL),
    answerRefused(A_STALE_KEY, REFUSAL),
  ],
  home: AskAnswerState.guards.Open,
  identity: (state) => caseName(AskAnswerState, state),
  invariants: [
    {
      name: 'a refusal says why',
      holds: (state) => !AskAnswerState.guards.Refused(state) || state.message !== '',
    },
  ],
  arrowRules: [
    {
      name: 'the same dialog asked again opens with nothing of the last answer',
      holds: ({ from, event, to }) =>
        !AskAnswerEvent.guards.AskShown(event) ||
        AskAnswerState.guards.Open(from) ||
        from.asking === event.asking ||
        AskAnswerState.guards.Open(to),
    },
    {
      name: 'the row still asking what was answered changes nothing, as the agent still refuses it',
      holds: ({ from, event, to }) =>
        !AskAnswerEvent.guards.AskShown(event) ||
        AskAnswerState.guards.Open(from) ||
        from.asking !== event.asking ||
        from === to,
    },
    {
      name: 'a finished event under another key changes nothing',
      holds: ({ from, event, to }) =>
        !settlesAnAnswer(event) || event.key !== A_STALE_KEY || from === to,
    },
    {
      name: 'an answer settles only from a state that carries one',
      holds: ({ from, event, to }) =>
        !settlesAnAnswer(event) || !AskAnswerState.guards.Open(from) || from === to,
    },
    {
      name: 'hearing the same thing twice changes nothing, since each render hears it again',
      holds: ({ event, to }) =>
        AskAnswerEvent.guards.AnswerPressed(event) ||
        askAnswerMachine.transition(to, event)[0] === to,
    },
  ],
}
