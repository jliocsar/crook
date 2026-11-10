import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

import { PermissionAsk, RunCommand } from '@crook/domain/Ask'
import { AnswerAsk, Approve, ApproveAlways } from '@crook/domain/Command'
import { AskId, IdempotencyKey, PaneId } from '@crook/domain/Ids'
import { walk } from '@crook/state-machine/Walk'
import { AskDialogUnreadable, AskNotPending } from '@crook/protocol/Commands'
import { ActionProgress, UNCONFIRMED_NOTE } from '@crook/web/atoms/ActionProgress'
import {
  answerHeard,
  answerInFlight,
  answerPressed,
  answerRefused,
  askAnswerMachine,
  AskAnswerState,
  askingOf,
  askShown,
  delivered,
  isAnswerUnderway,
  notPending,
} from '@crook/web/chat/AskAnswerMachine'
import type { AskAnswerEvent } from '@crook/web/chat/AskAnswerMachine'

import { askAnswerWalk } from '../../charts/AskAnswerWalk.ts'
import { agent } from '../HerdFixtures.ts'
import { inputDelivered } from '../HubFakes.ts'

const KEY = IdempotencyKey.make('key')
const RETRY_KEY = IdempotencyKey.make('retry key')
const ASKING = 'asking'
const ASKED_AGAIN = 'asked again'
const MESSAGE = 'crook could not read the dialog'
const PANE = PaneId.make('w1:p1')
const ASK = AskId.make('toolu_1')
const PRESSED = answerPressed(ASKING, KEY, new Approve())

const after = (events: readonly AskAnswerEvent[]) =>
  Arr.reduce(
    events,
    askAnswerMachine.initial,
    (state, event) => askAnswerMachine.transition(state, event)[0],
  )

const ask = (id: string, dialog: Option.Option<string>) =>
  new PermissionAsk({
    id: AskId.make(id),
    source: 'screen',
    tool: 'Bash',
    plugin: Option.none(),
    action: new RunCommand({ command: 'touch a.txt' }),
    options: [],
    dialog,
  })

const receipt = inputDelivered(new AnswerAsk({ pane: PANE, ask: ASK, answer: new Approve() }))

const failed = ActionProgress.Failed({ message: MESSAGE, asksConfirmation: false })

const heard = (
  state: ActionProgress<typeof receipt>,
  refusal: Parameters<typeof answerHeard>[0]['refusal'] = Option.none(),
) => answerHeard({ state, refusal, key: KEY })

describe('the ask answer machine', () => {
  it('walks clean', () => {
    expect(walk(askAnswerWalk).findings).toEqual([])
  })

  it('goes from a press to what the agent answered', () => {
    const { answer } = PRESSED

    expect(after([PRESSED])).toEqual(
      AskAnswerState.cases.Answering.make({ asking: ASKING, key: KEY, answer }),
    )
    expect(after([PRESSED, delivered(KEY)])).toEqual(
      AskAnswerState.cases.Answered.make({ asking: ASKING, key: KEY, answer }),
    )
    expect(after([PRESSED, notPending(KEY)])).toEqual(
      AskAnswerState.cases.AlreadyAnswered.make({ asking: ASKING, key: KEY, answer }),
    )
    expect(after([PRESSED, answerRefused(KEY, MESSAGE)])).toEqual(
      AskAnswerState.cases.Refused.make({ asking: ASKING, key: KEY, answer, message: MESSAGE }),
    )
  })

  it('opens the same dialog asked again from whatever the last answer came to', () => {
    const open = askAnswerMachine.initial

    expect(after([PRESSED, askShown(ASKED_AGAIN)])).toBe(open)
    expect(after([PRESSED, delivered(KEY), askShown(ASKED_AGAIN)])).toBe(open)
    expect(after([PRESSED, notPending(KEY), askShown(ASKED_AGAIN)])).toBe(open)
    expect(after([PRESSED, answerRefused(KEY, MESSAGE), askShown(ASKED_AGAIN)])).toBe(open)
  })

  it('keeps what the answer came to while the row asks what was answered', () => {
    const answered = after([PRESSED, delivered(KEY)])

    expect(askAnswerMachine.transition(answered, askShown(ASKING))[0]).toBe(answered)
  })

  it('drops an answer heard after the row moved on, which does not reach the next press', () => {
    const moved = [PRESSED, askShown(ASKED_AGAIN)]
    const next = answerPressed(ASKED_AGAIN, RETRY_KEY, new ApproveAlways())

    expect(after([...moved, delivered(KEY)])).toBe(askAnswerMachine.initial)
    expect(after([...moved, next, delivered(KEY)])).toEqual(after([next]))
    expect(after([...moved, next, notPending(KEY)])).toEqual(after([next]))
    expect(after([...moved, next, answerRefused(KEY, MESSAGE)])).toEqual(after([next]))
  })

  it('lets what the herd shows late finish an answer that gave up', () => {
    const gaveUp = [PRESSED, delivered(KEY), answerRefused(KEY, UNCONFIRMED_NOTE)]

    expect(AskAnswerState.guards.Refused(after(gaveUp))).toBe(true)
    expect(AskAnswerState.guards.Answered(after([...gaveUp, delivered(KEY)]))).toBe(true)
  })

  it('names the answer in flight only while it is', () => {
    expect(answerInFlight(after([PRESSED]))).toEqual(Option.some(PRESSED.answer))
    expect(answerInFlight(after([PRESSED, delivered(KEY)]))).toEqual(Option.none())
    expect(isAnswerUnderway(after([PRESSED, delivered(KEY)]))).toBe(false)
  })
})

describe('what the row asks', () => {
  const row = (seq: number, terminalPane = 'w1:p1') => agent(terminalPane, 'blocked', { seq })
  const asked = ask('screen-1', Option.some('fingerprint'))

  it('stays one asking while the terminal, the sequence, the id and the dialog hold', () => {
    expect(askingOf(row(1), asked)).toBe(askingOf(row(1), asked))
  })

  it('is a new asking if any of what the agent remembers an answer by changes', () => {
    const first = askingOf(row(1), asked)

    expect(askingOf(row(3), asked)).not.toBe(first)
    expect(askingOf(row(1, 'w1:p2'), asked)).not.toBe(first)
    expect(askingOf(row(1), ask('screen-2', Option.some('fingerprint')))).not.toBe(first)
    expect(askingOf(row(1), ask('screen-1', Option.some('another')))).not.toBe(first)
  })
})

describe('what an action says about an answer', () => {
  it('says nothing until the agent answered', () => {
    expect(heard(ActionProgress.Idle())).toEqual(Option.none())
    expect(heard(ActionProgress.Sending())).toEqual(Option.none())
  })

  it('counts a delivered answer whether or not the herd has shown it', () => {
    expect(heard(ActionProgress.Sent({ receipt }))).toEqual(Option.some(delivered(KEY)))
    expect(heard(ActionProgress.Done({ receipt }))).toEqual(Option.some(delivered(KEY)))
  })

  it('tells an answer that never showed from one the agent refused', () => {
    expect(heard(ActionProgress.Unconfirmed({ receipt }))).toEqual(
      Option.some(answerRefused(KEY, UNCONFIRMED_NOTE)),
    )
    expect(heard(failed, Option.some(new AskNotPending({ pane: PANE, ask: ASK })))).toEqual(
      Option.some(notPending(KEY)),
    )
    expect(heard(failed, Option.some(new AskDialogUnreadable({ pane: PANE })))).toEqual(
      Option.some(answerRefused(KEY, MESSAGE)),
    )
  })
})
