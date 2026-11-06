import { Approve, type AskAnswer } from '@crook/domain/Command'
import { MachineId, PaneId, AskId } from '@crook/domain/Ids'
import { AskNotPending, CommandTimedOut, MachineOffline } from '@crook/protocol/Commands'
import * as Duration from 'effect/Duration'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import {
  AnswerCommand,
  AnswerEvent,
  AnswerState,
  HARK_CLOSED,
  WITHDRAWN,
  approvalAnswerMachine,
} from '@crook/hub/ApprovalAnswerMachine'
import { caseName } from '@crook/web/machine/Machine'
import type { WalkSpec } from '@crook/web/machine/Walk'

const A_DEADLINE = 1000
const AN_ANSWER: AskAnswer = new Approve()
const A_MACHINE = MachineId.make('laptop')
const OFFLINE = new MachineOffline({ machine: A_MACHINE })
const TIMED_OUT = new CommandTimedOut({ machine: A_MACHINE, timeout: Duration.seconds(5) })
const REFUSED = new AskNotPending({ pane: PaneId.make('w1:p1'), ask: AskId.make('toolu_1') })

const attemptOf = (state: AnswerState): number =>
  Match.value(state).pipe(
    Match.tagsExhaustive({
      Polling: () => 0,
      Holding: ({ attempt }) => attempt,
      Sending: ({ attempt }) => attempt,
      SendingWithdrawn: ({ attempt }) => attempt,
      Ended: () => 0,
    }),
  )

const attemptOfEvent = (event: AnswerEvent): Option.Option<number> =>
  Match.value(event).pipe(
    Match.tags({
      AskOpen: ({ attempt }) => Option.some(attempt),
      AskMovedOn: ({ attempt }) => Option.some(attempt),
      AnswerAgedOut: ({ attempt }) => Option.some(attempt),
      SendFinished: ({ attempt }) => Option.some(attempt),
    }),
    Match.orElse(() => Option.none()),
  )

const isStale = (from: AnswerState, event: AnswerEvent) =>
  Option.exists(attemptOfEvent(event), (attempt) => attempt !== attemptOf(from))

const holdsAnAnswer = (state: AnswerState) =>
  AnswerState.guards.Holding(state) ||
  AnswerState.guards.Sending(state) ||
  AnswerState.guards.SendingWithdrawn(state)

const eventsAt = (attempt: number): readonly AnswerEvent[] => [
  AnswerEvent.cases.AskOpen.make({ attempt }),
  AnswerEvent.cases.AskMovedOn.make({ attempt }),
  AnswerEvent.cases.AnswerAgedOut.make({ attempt }),
  AnswerEvent.cases.SendFinished.make({ attempt, failure: Option.none() }),
  AnswerEvent.cases.SendFinished.make({ attempt, failure: Option.some(OFFLINE) }),
  AnswerEvent.cases.SendFinished.make({ attempt, failure: Option.some(TIMED_OUT) }),
  AnswerEvent.cases.SendFinished.make({ attempt, failure: Option.some(REFUSED) }),
]

export const approvalAnswerWalk: WalkSpec<AnswerState, AnswerEvent, AnswerCommand> = {
  machine: approvalAnswerMachine,
  events: (state) => [
    AnswerEvent.cases.HarkAnswered.make({ answer: AN_ANSWER, deadline: A_DEADLINE }),
    HARK_CLOSED,
    WITHDRAWN,
    ...eventsAt(attemptOf(state)),
    ...eventsAt(attemptOf(state) + 1),
  ],
  home: AnswerState.guards.Polling,
  terminal: AnswerState.guards.Ended,
  identity: (state) =>
    AnswerState.guards.Holding(state)
      ? `Holding/${Option.isSome(state.lastFailure)}`
      : caseName(AnswerState, state),
  commandName: AnswerCommand.$match({
    Poll: () => 'Poll',
    Hold: () => 'Hold',
    Send: () => 'Send',
    Record: () => 'Record',
  }),
  invariants: [
    {
      name: 'a hold always has a time it ends',
      holds: (state) => !AnswerState.guards.Holding(state) || state.deadline > 0,
    },
  ],
  arrowRules: [
    {
      name: 'an answer goes out only from a hold, on the open of that very hold',
      holds: ({ from, event, commands }) =>
        !commands.some(AnswerCommand.$is('Send')) ||
        (AnswerState.guards.Holding(from) &&
          AnswerEvent.guards.AskOpen(event) &&
          event.attempt === from.attempt),
    },
    {
      name: 'a fate is recorded once, on the way into the end',
      holds: ({ from, to, commands }) =>
        commands.filter(AnswerCommand.$is('Record')).length ===
        (holdsAnAnswer(from) && AnswerState.guards.Ended(to) ? 1 : 0),
    },
    {
      name: 'what ended stays ended and does nothing',
      holds: ({ from, to, commands }) =>
        !AnswerState.guards.Ended(from) || (AnswerState.guards.Ended(to) && commands.length === 0),
    },
    {
      name: 'a finished wait or send of another attempt changes nothing',
      holds: ({ from, event, to, commands }) =>
        !isStale(from, event) || (from === to && commands.length === 0),
    },
    {
      name: 'a delivered answer never waits again',
      holds: ({ from, event, to }) =>
        !AnswerEvent.guards.SendFinished(event) ||
        isStale(from, event) ||
        !holdsAnAnswer(from) ||
        AnswerState.guards.Holding(from) ||
        Option.isSome(event.failure) ||
        AnswerState.guards.Ended(to),
    },
    {
      name: 'a withdrawal sends nothing and does not cut a send short',
      holds: ({ from, event, to, commands }) =>
        !AnswerEvent.guards.Withdrawn(event) ||
        (!commands.some(AnswerCommand.$is('Send')) &&
          (!AnswerState.guards.Sending(from) ||
            (AnswerState.guards.SendingWithdrawn(to) && commands.length === 0))),
    },
    {
      name: 'entering a hold starts what ends it',
      holds: ({ from, to, commands }) =>
        !AnswerState.guards.Holding(to) ||
        from === to ||
        commands.some(
          (command) => AnswerCommand.$is('Hold')(command) && command.attempt === to.attempt,
        ),
    },
    {
      name: 'only a send that may not have landed holds again, and always under a new attempt',
      holds: ({ from, to }) =>
        !AnswerState.guards.Sending(from) ||
        !AnswerState.guards.Holding(to) ||
        (Option.isSome(to.lastFailure) && to.attempt === from.attempt + 1),
    },
  ],
}
