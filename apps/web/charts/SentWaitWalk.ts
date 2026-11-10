import {
  answered,
  boundEnded,
  NOT_SENT,
  SentWaitCommand,
  SentWaitEvent,
  sentWaitMachine,
  SentWaitState,
  SETTLED,
} from '@crook/web/actions/SentWaitMachine'
import { caseName } from '@crook/state-machine/Machine'
import type { WalkSpec } from '@crook/state-machine/Walk'

const AN_ANSWER = 1000
const ANOTHER_ANSWER = 2000

export const sentWaitWalk: WalkSpec<SentWaitState, SentWaitEvent, SentWaitCommand> = {
  machine: sentWaitMachine,
  events: () => [
    answered(AN_ANSWER),
    answered(ANOTHER_ANSWER),
    SETTLED,
    boundEnded(AN_ANSWER),
    boundEnded(ANOTHER_ANSWER),
  ],
  home: SentWaitState.guards.NotSent,
  identity: (state) => caseName(SentWaitState, state),
  commandName: SentWaitCommand.$match({
    WaitOutBound: () => 'WaitOutBound',
  }),
  invariants: [
    {
      name: 'nothing is waited for before an answer',
      holds: (state) => !SentWaitState.guards.NotSent(state) || state === NOT_SENT,
    },
  ],
  arrowRules: [
    {
      name: 'a wait for another answer ending changes nothing',
      holds: ({ from, event, to }) =>
        !SentWaitEvent.guards.BoundEnded(event) ||
        !SentWaitState.guards.Awaiting(from) ||
        from.answeredAt === event.answeredAt ||
        from === to,
    },
    {
      name: 'entering a wait starts what ends it',
      holds: ({ from, to, commands }) =>
        !SentWaitState.guards.Awaiting(to) || from === to || commands.length === 1,
    },
    {
      name: 'what the herd shows late still settles a wait that gave up',
      holds: ({ from, event, to }) =>
        !SentWaitState.guards.Unconfirmed(from) ||
        !SentWaitEvent.guards.Settled(event) ||
        to === NOT_SENT,
    },
    {
      name: 'a step starts one command at most, since the next call of an atom function ends the last',
      holds: ({ commands }) => commands.length <= 1,
    },
  ],
}
