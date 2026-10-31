import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Equal from 'effect/Equal'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Semaphore from 'effect/Semaphore'
import * as Stream from 'effect/Stream'
import * as SynchronizedRef from 'effect/SynchronizedRef'

import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { PaneScreens } from '@crook/agent/PaneScreens'
import { choiceLabel, optionChoice } from '@crook/claude/AskDerivation'
import {
  type DialogOption,
  type ScreenDialog,
  dialogFingerprint,
  keysToSelect,
} from '@crook/claude/ScreenDialog'
import type { AgentRow } from '@crook/domain/AgentRow'
import { type Ask, type AskChoice, askDialog } from '@crook/domain/Ask'
import type { AnswerAsk, Choose } from '@crook/domain/Command'
import type { AskId, PaneId } from '@crook/domain/Ids'
import type { MachineState } from '@crook/domain/MachineState'
import { HerdrClient, type HerdrRequestError } from '@crook/herdr/HerdrClient'
import { AgentPromptMethod, AgentSendKeysMethod } from '@crook/herdr/Methods'
import {
  AskDialogUnreadable,
  AskNotPending,
  AskOptionUnavailable,
  DeclineMessageUndelivered,
  QuestionnaireUnsupported,
} from '@crook/protocol/Commands'

interface AnsweredAsk {
  readonly ask: AskId
  readonly terminal: AgentRow['terminal']
  readonly stateChangeSeq: number
}

export type AnswerFailure =
  | AskNotPending
  | AskDialogUnreadable
  | AskOptionUnavailable
  | QuestionnaireUnsupported
  | HerdrRequestError

const DECLINE_KEY = 'esc'
const SLOWEST_MEASURED_UNBLOCK = Duration.millis(380)

const isBlockedIn = (state: MachineState, pane: PaneId) =>
  Arr.some(state.agents, (agent) => agent.pane === pane && agent.status === 'blocked')

const requireChoosable = (
  pane: PaneId,
  ask: Ask,
  chosen: Choose,
): Effect.Effect<void, AskOptionUnavailable | QuestionnaireUnsupported> =>
  Match.value(ask).pipe(
    Match.tag('QuestionAsk', (question) =>
      question.questions.length === 1 && Option.contains(question.questions[0].multiSelect, false)
        ? Effect.fromOption(
            Arr.findFirst(
              question.questions[0].choices,
              (choice) => choice.label === chosen.answer,
            ),
            () => new AskOptionUnavailable({ pane, option: chosen.answer }),
          )
        : Effect.fail(new QuestionnaireUnsupported({ pane })),
    ),
    Match.orElse(() => Effect.fail(new AskOptionUnavailable({ pane, option: chosen.answer }))),
  )

const isSameAnswer = (row: AgentRow, ask: AskId) => (answered: AnsweredAsk) =>
  answered.ask === ask &&
  answered.terminal === row.terminal &&
  answered.stateChangeSeq === row.stateChangeSeq

const make = Effect.gen(function* () {
  const herdr = yield* HerdrClient
  const sync = yield* MachineStateSync
  const screens = yield* PaneScreens
  const answered = yield* Ref.make(HashMap.empty<PaneId, AnsweredAsk>())
  const scope = yield* Effect.scope
  const locks = yield* SynchronizedRef.make(HashMap.empty<PaneId, Semaphore.Semaphore>())

  const pressKeys = (pane: PaneId, keys: readonly string[]) =>
    herdr.request(AgentSendKeysMethod, { target: pane, keys })

  const lockOf = (pane: PaneId) =>
    SynchronizedRef.modifyEffect(locks, (current) =>
      Option.match(HashMap.get(current, pane), {
        onSome: (lock) => Effect.succeed([lock, current] as const),
        onNone: () =>
          Effect.map(
            Semaphore.make(1),
            (lock) => [lock, HashMap.set(current, pane, lock)] as const,
          ),
      }),
    )

  const exclusive = <Value, Failure, Requirements>(
    pane: PaneId,
    effect: Effect.Effect<Value, Failure, Requirements>,
  ) => Effect.flatMap(lockOf(pane), (lock) => lock.withPermit(effect))

  const refuseAnswered = (answer: AnswerAsk, row: AgentRow) =>
    Effect.flatMap(Ref.get(answered), (current) =>
      Option.exists(HashMap.get(current, answer.pane), isSameAnswer(row, answer.ask))
        ? Effect.andThen(
            sync.invalidate,
            Effect.fail(new AskNotPending({ pane: answer.pane, ask: answer.ask })),
          )
        : Effect.void,
    )

  const unblocked = (pane: PaneId) =>
    sync.changes.pipe(
      Stream.filter((state) => !isBlockedIn(state, pane)),
      Stream.runHead,
    )

  const refreshWhileBlocked = (pane: PaneId) =>
    unblocked(pane).pipe(
      Effect.timeoutOrElse({
        duration: SLOWEST_MEASURED_UNBLOCK,
        orElse: () => Effect.as(sync.invalidate, Option.none()),
      }),
      Effect.forkIn(scope),
    )

  const remember = (answer: AnswerAsk, row: AgentRow) =>
    Ref.update(
      answered,
      HashMap.set(answer.pane, {
        ask: answer.ask,
        terminal: row.terminal,
        stateChangeSeq: row.stateChangeSeq,
      }),
    )

  const shownDialog = Effect.fn('AskAnswers.shownDialog')(function* (answer: AnswerAsk, ask: Ask) {
    const unreadable = () => Effect.fail(new AskDialogUnreadable({ pane: answer.pane }))
    const { dialog } = yield* screens.read(answer.pane).pipe(
      Effect.catchTags({
        HerdrConnectionClosed: unreadable,
        HerdrResponseInvalid: unreadable,
      }),
    )

    if (!Equal.equals(Option.map(dialog, dialogFingerprint), askDialog(ask))) {
      yield* sync.invalidate

      return yield* new AskNotPending({ pane: answer.pane, ask: answer.ask })
    }

    return dialog
  })

  const selectOption = Effect.fn('AskAnswers.selectOption')(function* (
    pane: PaneId,
    dialog: Option.Option<ScreenDialog>,
    wanted: string,
    isWanted: (option: DialogOption) => boolean,
  ) {
    const shown = yield* Effect.fromOption(dialog, () => new AskDialogUnreadable({ pane }))
    const option = yield* Effect.fromOption(
      Arr.findFirst(shown.options, isWanted),
      () => new AskOptionUnavailable({ pane, option: wanted }),
    )
    const keys = yield* Effect.fromOption(
      keysToSelect(shown, option.number),
      () => new AskDialogUnreadable({ pane }),
    )

    yield* pressKeys(pane, keys)
  })

  const selectChoice = (pane: PaneId, dialog: Option.Option<ScreenDialog>, choice: AskChoice) =>
    selectOption(
      pane,
      dialog,
      choiceLabel(choice),
      (option) => optionChoice(option.label) === choice,
    )

  const answer = Effect.fn('AskAnswers.answer')(function* (given: AnswerAsk, row: AgentRow) {
    const ask = yield* Effect.fromOption(
      row.ask,
      () => new AskNotPending({ pane: given.pane, ask: given.ask }),
    )
    yield* Match.value(given.answer).pipe(
      Match.tag('Choose', (choose) => requireChoosable(given.pane, ask, choose)),
      Match.orElse(() => Effect.void),
    )
    const dialog = yield* shownDialog(given, ask)

    yield* Match.value(given.answer).pipe(
      Match.tagsExhaustive({
        Approve: () => selectChoice(given.pane, dialog, 'yes'),
        ApproveAlways: () => selectChoice(given.pane, dialog, 'always'),
        Decline: () => pressKeys(given.pane, [DECLINE_KEY]),
        Choose: (choose) =>
          selectOption(
            given.pane,
            dialog,
            choose.answer,
            (option) => option.label === choose.answer,
          ),
      }),
    )

    yield* refreshWhileBlocked(given.pane)
  })

  const promptAfterDecline = Effect.fn('AskAnswers.promptAfterDecline')(function* (
    pane: PaneId,
    text: string,
    budget: Duration.Duration,
  ) {
    const undelivered = (reason: string) => new DeclineMessageUndelivered({ pane, reason })
    const [waited] = yield* unblocked(pane).pipe(
      Effect.timeoutOrElse({
        duration: budget,
        orElse: () => Effect.fail(undelivered('the agent still looked blocked after Esc')),
      }),
      Effect.timed,
    )

    yield* herdr.request(AgentPromptMethod, { target: pane, text }).pipe(
      Effect.mapError((error) => undelivered(error.message)),
      Effect.timeoutOrElse({
        duration: Duration.max(Duration.subtract(budget, waited), Duration.zero),
        orElse: () => Effect.fail(undelivered('herdr did not confirm the prompt in time')),
      }),
    )
  })

  return AskAnswers.of({ exclusive, refuseAnswered, remember, answer, promptAfterDecline })
})

export class AskAnswers extends Context.Service<
  AskAnswers,
  {
    readonly exclusive: <Value, Failure, Requirements>(
      pane: PaneId,
      effect: Effect.Effect<Value, Failure, Requirements>,
    ) => Effect.Effect<Value, Failure, Requirements>
    readonly refuseAnswered: (
      answer: AnswerAsk,
      row: AgentRow,
    ) => Effect.Effect<void, AskNotPending>
    readonly remember: (answer: AnswerAsk, row: AgentRow) => Effect.Effect<void>
    readonly answer: (answer: AnswerAsk, row: AgentRow) => Effect.Effect<void, AnswerFailure>
    readonly promptAfterDecline: (
      pane: PaneId,
      text: string,
      budget: Duration.Duration,
    ) => Effect.Effect<void, DeclineMessageUndelivered>
  }
>()('@crook/agent/AskAnswers') {
  static readonly layer = Layer.effect(this, make)
}
