import * as Arr from 'effect/Array'
import * as Cache from 'effect/Cache'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Stream from 'effect/Stream'

import { AuditLog } from '@crook/agent/AuditLog'
import { CommandPolicy } from '@crook/agent/CommandPolicy'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { paneLabel } from '@crook/agent/MachineStateMapping'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { readPaneScreen } from '@crook/agent/PendingAsks'
import { optionChoice } from '@crook/claude/AskDerivation'
import { type DialogOption, keysToSelect } from '@crook/claude/PermissionDialog'
import type { AgentRow } from '@crook/domain/AgentRow'
import type { Ask, AskChoice } from '@crook/domain/Ask'
import {
  type AnswerAsk,
  type Choose,
  type Command,
  type CommandReceipt,
  InputDelivered,
  PaneClosed,
  PaneRenamed,
  targetPane,
} from '@crook/domain/Command'
import type { IdempotencyKey, PaneId } from '@crook/domain/Ids'
import type { MachineState } from '@crook/domain/MachineState'
import { HerdrClient } from '@crook/herdr/HerdrClient'
import {
  AgentPromptMethod,
  AgentSendKeysMethod,
  PaneCloseMethod,
  PaneRenameMethod,
} from '@crook/herdr/Methods'
import {
  type AgentCommandFailure,
  AskDialogUnreadable,
  AskOptionUnavailable,
  CommandDeliveryUnknown,
  DeclineMessageUndelivered,
  HerdrRefusedCommand,
  HerdrUnavailable,
  PaneNotAgent,
  QuestionnaireUnsupported,
} from '@crook/protocol/Commands'

interface Execution {
  readonly key: IdempotencyKey
  readonly command: Command
}

const SLOWEST_MEASURED_PROMPT = Duration.millis(403)
const DECLINE_KEY = 'esc'

export const COMMAND_REPLAY_CAPACITY = 1024
export const HERDR_DELIVERY_TIMEOUT = Duration.times(SLOWEST_MEASURED_PROMPT, 10)

const CHOICE_LABELS = new Map<AskChoice, string>([
  ['yes', 'Yes'],
  ['always', 'Yes, and always allow'],
])

const isBlockedIn = (state: MachineState, pane: PaneId) =>
  Arr.some(state.agents, (agent) => agent.pane === pane && agent.status === 'blocked')

const isSingleChoice = (ask: Ask) =>
  Match.value(ask).pipe(
    Match.tagsExhaustive({
      PermissionAsk: () => true,
      QuestionAsk: (question) =>
        question.questions.length === 1 &&
        Option.contains(question.questions[0].multiSelect, false),
      UnknownAsk: () => true,
    }),
  )

const singleAnswer = (row: AgentRow, choose: Choose) =>
  pipe(
    row.ask,
    Option.filter(isSingleChoice),
    Option.filter(() => choose.answers.length === 1),
    Option.as(choose.answers[0]),
  )

const declineMessageOf = (command: Command) =>
  Match.value(command).pipe(
    Match.tag('AnswerAsk', (answer) =>
      Match.value(answer.answer).pipe(
        Match.tag('Decline', (decline) => decline.message),
        Match.orElse(() => Option.none<string>()),
      ),
    ),
    Match.orElse(() => Option.none<string>()),
  )

const inputDelivered = (row: AgentRow): CommandReceipt =>
  new InputDelivered({
    pane: row.pane,
    terminal: row.terminal,
    stateChangeSeq: row.stateChangeSeq,
  })

const make = Effect.gen(function* () {
  const herdr = yield* HerdrClient
  const policy = yield* CommandPolicy
  const sync = yield* MachineStateSync
  const createdPanes = yield* CreatedPanes
  const audit = yield* AuditLog

  const pressKeys = (pane: PaneId, keys: readonly string[]) =>
    herdr.request(AgentSendKeysMethod, { target: pane, keys })

  const selectOption = Effect.fn('CommandExecutor.selectOption')(function* (
    pane: PaneId,
    wanted: string,
    isWanted: (option: DialogOption) => boolean,
  ) {
    const { dialog } = yield* readPaneScreen(herdr, pane)
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

  const selectChoice = (pane: PaneId, choice: AskChoice) =>
    selectOption(
      pane,
      CHOICE_LABELS.get(choice) ?? choice,
      (option) => optionChoice(option.label) === choice,
    )

  const choose = (pane: PaneId, row: AgentRow, chosen: Choose) =>
    Option.match(singleAnswer(row, chosen), {
      onNone: () => Effect.fail(new QuestionnaireUnsupported({ pane })),
      onSome: (label) => selectOption(pane, label, (option) => option.label === label),
    })

  const answerAsk = (answer: AnswerAsk, row: AgentRow) =>
    Match.value(answer.answer).pipe(
      Match.tagsExhaustive({
        Approve: () => selectChoice(answer.pane, 'yes'),
        ApproveAlways: () => selectChoice(answer.pane, 'always'),
        Decline: () => pressKeys(answer.pane, [DECLINE_KEY]),
        Choose: (chosen) => choose(answer.pane, row, chosen),
      }),
      Effect.as(inputDelivered(row)),
    )

  const promptAfterDecline = Effect.fn('CommandExecutor.promptAfterDecline')(function* (
    pane: PaneId,
    text: string,
  ) {
    const undelivered = (reason: string) => new DeclineMessageUndelivered({ pane, reason })

    yield* sync.changes.pipe(
      Stream.filter((state) => !isBlockedIn(state, pane)),
      Stream.runHead,
      Effect.timeoutOrElse({
        duration: HERDR_DELIVERY_TIMEOUT,
        orElse: () => Effect.fail(undelivered('the agent still looked blocked after Esc')),
      }),
    )
    yield* herdr.request(AgentPromptMethod, { target: pane, text }).pipe(
      Effect.mapError((error) => undelivered(error.message)),
      Effect.timeoutOrElse({
        duration: HERDR_DELIVERY_TIMEOUT,
        orElse: () => Effect.fail(undelivered('herdr did not confirm the prompt in time')),
      }),
    )
  })

  const afterDelivery = (
    command: Command,
    outcome: Result.Result<CommandReceipt, CommandDeliveryUnknown>,
  ): Effect.Effect<
    Result.Result<CommandReceipt, CommandDeliveryUnknown | DeclineMessageUndelivered>
  > =>
    Option.match(
      Option.filter(declineMessageOf(command), () => Result.isSuccess(outcome)),
      {
        onNone: () => Effect.succeed(outcome),
        onSome: (text) =>
          promptAfterDecline(targetPane(command), text).pipe(
            Effect.as(outcome),
            Effect.catchTag('DeclineMessageUndelivered', (error) =>
              Effect.succeed(Result.fail(error)),
            ),
          ),
      },
    )

  const deliver = (command: Command, row: AgentRow) =>
    Match.value(command).pipe(
      Match.tagsExhaustive({
        Prompt: (prompt) =>
          herdr
            .request(AgentPromptMethod, { target: prompt.pane, text: prompt.text })
            .pipe(Effect.as(inputDelivered(row))),
        SendKeys: (sendKeys) =>
          herdr
            .request(AgentSendKeysMethod, { target: sendKeys.pane, keys: sendKeys.keys })
            .pipe(Effect.as(inputDelivered(row))),
        RenameAgent: (rename) =>
          herdr
            .request(PaneRenameMethod, {
              pane_id: rename.pane,
              label: Option.getOrNull(rename.label),
            })
            .pipe(
              Effect.map(
                (reply) => new PaneRenamed({ pane: rename.pane, label: paneLabel(reply.pane) }),
              ),
            ),
        ClosePane: (close) =>
          herdr
            .request(PaneCloseMethod, { pane_id: close.pane })
            .pipe(Effect.as(new PaneClosed({ pane: close.pane }))),
        AnswerAsk: (answer) => answerAsk(answer, row),
      }),
    )

  const settle = (receipt: CommandReceipt) =>
    Match.value(receipt).pipe(
      Match.tagsExhaustive({
        InputDelivered: () => Effect.void,
        PaneRenamed: () => sync.invalidate,
        PaneClosed: (closed) =>
          createdPanes
            .forget(closed.pane)
            .pipe(
              Effect.catchTag('CreatedPanesUnwritable', (error) =>
                Effect.logWarning(error.message),
              ),
            ),
      }),
    )

  const run = Effect.fn('CommandExecutor.run')(function* ({ command }: Execution) {
    const row = yield* policy.admit(command)

    return yield* deliver(command, row).pipe(
      Effect.map(Result.succeed),
      Effect.timeoutOrElse({
        duration: HERDR_DELIVERY_TIMEOUT,
        orElse: () => Effect.succeed(Result.fail(new CommandDeliveryUnknown())),
      }),
      Effect.catchTags({
        HerdrConnectionClosed: () => Effect.succeed(Result.fail(new CommandDeliveryUnknown())),
        HerdrResponseInvalid: () => Effect.succeed(Result.fail(new CommandDeliveryUnknown())),
        HerdrUnreachable: () => Effect.fail(new HerdrUnavailable()),
        HerdrPaneNotFound: () => Effect.fail(new PaneNotAgent({ pane: row.pane })),
        HerdrAgentNotFound: () => Effect.fail(new PaneNotAgent({ pane: row.pane })),
        HerdrRequestRejected: (rejected) =>
          Effect.fail(new HerdrRefusedCommand({ code: rejected.code, detail: rejected.detail })),
        HerdrRequestInvalid: (invalid) => Effect.die(invalid),
      }),
      Effect.flatMap((outcome) => afterDelivery(command, outcome)),
      Effect.tap((outcome) =>
        Result.match(outcome, { onFailure: () => Effect.void, onSuccess: settle }),
      ),
    )
  })

  const outcomes = yield* Cache.makeWith(run, {
    capacity: COMMAND_REPLAY_CAPACITY,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
  })

  const execute = Effect.fn('CommandExecutor.execute')(function* (
    key: IdempotencyKey,
    command: Command,
  ) {
    return yield* Cache.get(outcomes, { key, command }).pipe(
      Effect.flatMap(Effect.fromResult),
      Effect.onExit((exit) =>
        audit
          .record(key, command, exit)
          .pipe(Effect.catchTag('AuditLogUnwritable', (error) => Effect.logError(error.message))),
      ),
    )
  }, Effect.uninterruptible)

  return CommandExecutor.of({ execute })
})

export class CommandExecutor extends Context.Service<
  CommandExecutor,
  {
    readonly execute: (
      key: IdempotencyKey,
      command: Command,
    ) => Effect.Effect<CommandReceipt, AgentCommandFailure>
  }
>()('@crook/agent/CommandExecutor') {
  static readonly layer = Layer.effect(this, make).pipe(Layer.provide(CommandPolicy.layer))
}
