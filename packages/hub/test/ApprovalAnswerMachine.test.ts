import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { describe, expect, it, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'

import { Approve, type AskAnswer } from '@crook/domain/Command'
import { MachineId } from '@crook/domain/Ids'
import {
  AnswerCommand,
  AnswerEvent,
  AnswerFate,
  AnswerState,
  ENDED,
  HARK_CLOSED,
  POLLING,
  WITHDRAWN,
  approvalAnswerMachine,
} from '@crook/hub/ApprovalAnswerMachine'
import { chartOf, walk } from '@crook/web/machine/Walk'
import { CommandTimedOut, MachineOffline } from '@crook/protocol/Commands'

import { approvalAnswerWalk } from '../charts/ApprovalAnswerWalk.ts'

const DEADLINE = 1000
const STATES_THE_WALK_REACHES = 6
const LAPTOP = MachineId.make('laptop')
const APPROVE: AskAnswer = new Approve()
const OFFLINE = new MachineOffline({ machine: LAPTOP })
const TIMED_OUT = new CommandTimedOut({ machine: LAPTOP, timeout: Duration.seconds(5) })
const ANSWERED = AnswerEvent.cases.HarkAnswered.make({ answer: APPROVE, deadline: DEADLINE })

const FIRST_HOLD = AnswerState.cases.Holding.make({
  answer: APPROVE,
  deadline: DEADLINE,
  attempt: 0,
  lastFailure: Option.none(),
})

const FIRST_SEND = AnswerState.cases.Sending.make({
  answer: APPROVE,
  deadline: DEADLINE,
  attempt: 0,
})

const OPEN = AnswerEvent.cases.AskOpen.make({ attempt: 0 })
const DELIVERED = AnswerEvent.cases.SendFinished.make({ attempt: 0, failure: Option.none() })

const TIMED_OUT_SEND = AnswerEvent.cases.SendFinished.make({
  attempt: 0,
  failure: Option.some(TIMED_OUT),
})

const recorded = (fate: AnswerFate) => [AnswerCommand.Record({ answer: APPROVE, fate })]

describe('the approval answer machine', () => {
  it('walks clean', () => {
    const walked = walk(approvalAnswerWalk)

    expect(walked.findings).toEqual([])
    expect(walked.states.length).toBe(STATES_THE_WALK_REACHES)
  })

  it('holds an answer before it does anything with it', () => {
    expect(approvalAnswerMachine.transition(POLLING, ANSWERED)).toEqual([
      FIRST_HOLD,
      [AnswerCommand.Hold({ attempt: 0, deadline: DEADLINE })],
    ])
  })

  it('ends with no record when nobody answered', () => {
    expect(approvalAnswerMachine.transition(POLLING, HARK_CLOSED)).toEqual([ENDED, []])
    expect(approvalAnswerMachine.transition(POLLING, WITHDRAWN)).toEqual([ENDED, []])
  })

  it('records what a withdrawal of a held answer means, once', () => {
    const [state, commands] = approvalAnswerMachine.transition(FIRST_HOLD, WITHDRAWN)

    expect(state).toEqual(ENDED)
    expect(commands).toEqual(recorded(AnswerFate.NoLongerAsked()))
    expect(approvalAnswerMachine.transition(state, WITHDRAWN)).toEqual([ENDED, []])
  })

  it('lets a withdrawn send finish, and records its real outcome', () => {
    const [withdrawn, cut] = approvalAnswerMachine.transition(FIRST_SEND, WITHDRAWN)

    expect(cut).toEqual([])
    expect(approvalAnswerMachine.transition(withdrawn, TIMED_OUT_SEND)).toEqual([
      ENDED,
      recorded(AnswerFate.Failed({ failure: TIMED_OUT })),
    ])
    expect(approvalAnswerMachine.transition(withdrawn, DELIVERED)).toEqual([
      ENDED,
      recorded(AnswerFate.Delivered()),
    ])
  })

  it('holds again after a send that may not have landed, under a new attempt', () => {
    const [held, commands] = approvalAnswerMachine.transition(FIRST_SEND, TIMED_OUT_SEND)
    const stale = approvalAnswerMachine.transition(held, OPEN)

    expect(commands).toEqual([AnswerCommand.Hold({ attempt: 1, deadline: DEADLINE })])
    expect(stale).toEqual([held, []])
  })

  it('says what it last knew when a retried answer ages out or is withdrawn', () => {
    const [held] = approvalAnswerMachine.transition(
      FIRST_SEND,
      AnswerEvent.cases.SendFinished.make({ attempt: 0, failure: Option.some(OFFLINE) }),
    )

    expect(approvalAnswerMachine.transition(held, WITHDRAWN)).toEqual([
      ENDED,
      recorded(AnswerFate.Failed({ failure: OFFLINE })),
    ])
    expect(
      approvalAnswerMachine.transition(held, AnswerEvent.cases.AnswerAgedOut.make({ attempt: 1 })),
    ).toEqual([ENDED, recorded(AnswerFate.AgedOut())])
  })

  it('sends once per hold, however many times the link says yes', () => {
    const [sending, first] = approvalAnswerMachine.transition(FIRST_HOLD, OPEN)
    const [, again] = approvalAnswerMachine.transition(sending, OPEN)

    expect(Arr.map(first, AnswerCommand.$is('Send'))).toEqual([true])
    expect(again).toEqual([])
  })
})

layer(BunFileSystem.layer)('the approval answer chart', (live) => {
  live.effect('is what the table draws', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const committed = yield* fileSystem.readFileString(
        new URL('../charts/approval-answer.mmd', import.meta.url).pathname,
      )

      expect(committed).toBe(chartOf(walk(approvalAnswerWalk)))
    }),
  )
})
