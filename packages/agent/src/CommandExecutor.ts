import * as Cache from 'effect/Cache'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { AgentLauncher } from '@crook/agent/AgentLauncher'
import { AskAnswers } from '@crook/agent/AskAnswers'
import { AuditLog } from '@crook/agent/AuditLog'
import { CommandPolicy } from '@crook/agent/CommandPolicy'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { paneLabel } from '@crook/agent/MachineStateMapping'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import type { AgentRow } from '@crook/domain/AgentRow'
import {
  type AnswerAsk,
  type Command,
  type CommandReceipt,
  InputDelivered,
  type LaunchCommand,
  PaneClosed,
  type PaneCommand,
  PaneRenamed,
  targetPane,
} from '@crook/domain/Command'
import type { IdempotencyKey } from '@crook/domain/Ids'
import {
  HerdrClient,
  type HerdrPaneBusy,
  type HerdrRequestRejected,
} from '@crook/herdr/HerdrClient'
import {
  AgentPromptMethod,
  AgentSendKeysMethod,
  PaneCloseMethod,
  PaneRenameMethod,
} from '@crook/herdr/Methods'
import { LAUNCH_HERDR_WAIT } from '@crook/protocol/AgentLink'
import {
  type AgentCommandFailure,
  CommandDeliveryUnknown,
  type DeclineMessageUndelivered,
  HerdrRefusedCommand,
  HerdrUnavailable,
  PaneNotAgent,
} from '@crook/protocol/Commands'

interface Execution {
  readonly key: IdempotencyKey
  readonly command: Command
}

type DeliveryOutcome = Result.Result<CommandReceipt, CommandDeliveryUnknown>

const SLOWEST_MEASURED_PROMPT = Duration.millis(403)
const COMMAND_REPLAY_CAPACITY = 1024

export const HERDR_DELIVERY_TIMEOUT = Duration.times(SLOWEST_MEASURED_PROMPT, 10)
export const LAUNCH_DELIVERY_TIMEOUT = Duration.sum(LAUNCH_HERDR_WAIT, HERDR_DELIVERY_TIMEOUT)

const answerOf = (command: PaneCommand) =>
  Match.value(command).pipe(
    Match.tag('AnswerAsk', (answer) => Option.some(answer)),
    Match.orElse(() => Option.none<AnswerAsk>()),
  )

const declineMessageOf = (answer: Option.Option<AnswerAsk>) =>
  Option.flatMap(answer, (found) =>
    Match.value(found.answer).pipe(
      Match.tag('Decline', (decline) => decline.message),
      Match.orElse(() => Option.none<string>()),
    ),
  )

const inputDelivered = (row: AgentRow): CommandReceipt =>
  new InputDelivered({
    pane: row.pane,
    terminal: row.terminal,
    stateChangeSeq: row.stateChangeSeq,
  })

const refusedCommand = (refused: HerdrPaneBusy | HerdrRequestRejected) =>
  Effect.fail(new HerdrRefusedCommand({ code: refused.code, detail: refused.detail }))

const make = Effect.gen(function* () {
  const herdr = yield* HerdrClient
  const policy = yield* CommandPolicy
  const sync = yield* MachineStateSync
  const createdPanes = yield* CreatedPanes
  const audit = yield* AuditLog
  const answers = yield* AskAnswers
  const launcher = yield* AgentLauncher

  const afterDelivery = (
    command: PaneCommand,
    answer: Option.Option<AnswerAsk>,
    outcome: DeliveryOutcome,
    budget: Duration.Duration,
  ): Effect.Effect<
    Result.Result<CommandReceipt, CommandDeliveryUnknown | DeclineMessageUndelivered>
  > =>
    Option.match(
      Option.filter(declineMessageOf(answer), () => Result.isSuccess(outcome)),
      {
        onNone: () => Effect.succeed(outcome),
        onSome: (text) =>
          answers.promptAfterDecline(targetPane(command), text, budget).pipe(
            Effect.as(outcome),
            Effect.catchTag('DeclineMessageUndelivered', (error) =>
              Effect.succeed(Result.fail(error)),
            ),
          ),
      },
    )

  const deliver = (command: PaneCommand, row: AgentRow) =>
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
        AnswerAsk: (answer) => answers.answer(answer, row).pipe(Effect.as(inputDelivered(row))),
      }),
    )

  const settle = (receipt: CommandReceipt) =>
    Match.value(receipt).pipe(
      Match.tagsExhaustive({
        InputDelivered: () => Effect.void,
        PaneRenamed: () => sync.invalidate,
        AgentStarted: () => Effect.void,
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

  const runLaunch = (command: LaunchCommand) =>
    launcher.launch(command).pipe(
      Effect.map(Result.succeed),
      Effect.timeoutOrElse({
        duration: LAUNCH_DELIVERY_TIMEOUT,
        orElse: () => Effect.succeed(Result.fail(new CommandDeliveryUnknown())),
      }),
      Effect.catchTags({
        AgentNotStarted: (notStarted) => Effect.succeed(Result.fail(notStarted)),
        TaskNotDelivered: (notDelivered) => Effect.succeed(Result.fail(notDelivered)),
        CommandDeliveryUnknown: (unknown) => Effect.succeed(Result.fail(unknown)),
      }),
    )

  const delivered = (
    command: PaneCommand,
    row: AgentRow,
  ): Effect.Effect<DeliveryOutcome, AgentCommandFailure> =>
    deliver(command, row).pipe(
      Effect.map(Result.succeed),
      Effect.timeoutOrElse({
        duration: HERDR_DELIVERY_TIMEOUT,
        orElse: () => Effect.succeed(Result.fail(new CommandDeliveryUnknown())),
      }),
      Effect.catchTags({
        HerdrConnectionClosed: () => Effect.succeed(Result.fail(new CommandDeliveryUnknown())),
        HerdrResponseInvalid: () => Effect.succeed(Result.fail(new CommandDeliveryUnknown())),
        HerdrPromptStalled: () => Effect.succeed(Result.fail(new CommandDeliveryUnknown())),
        HerdrUnreachable: () => Effect.fail(new HerdrUnavailable()),
        HerdrPaneNotFound: () => Effect.fail(new PaneNotAgent({ pane: row.pane })),
        HerdrAgentNotFound: () => Effect.fail(new PaneNotAgent({ pane: row.pane })),
        HerdrPaneBusy: refusedCommand,
        HerdrRequestRejected: refusedCommand,
        HerdrRequestInvalid: (invalid) => Effect.die(invalid),
      }),
    )

  const runAdmitted = Effect.fn('CommandExecutor.runAdmitted')(function* (
    command: PaneCommand,
    answer: Option.Option<AnswerAsk>,
  ) {
    const row = yield* policy.admit(command)

    yield* Option.match(answer, {
      onNone: () => Effect.void,
      onSome: (found) => answers.refuseAnswered(found, row),
    })

    const [spent, outcome] = yield* Effect.timed(delivered(command, row))

    yield* Option.match(answer, {
      onNone: () => Effect.void,
      onSome: (found) => answers.remember(found, row),
    })

    return yield* afterDelivery(
      command,
      answer,
      outcome,
      Duration.max(Duration.subtract(HERDR_DELIVERY_TIMEOUT, spent), Duration.zero),
    ).pipe(
      Effect.tap((settled) =>
        Result.match(settled, { onFailure: () => Effect.void, onSuccess: settle }),
      ),
    )
  })

  const runOnPane = Effect.fn('CommandExecutor.runOnPane')(function* (command: PaneCommand) {
    const answer = answerOf(command)

    return yield* Option.match(answer, {
      onNone: () => runAdmitted(command, answer),
      onSome: (found) => answers.exclusive(found.pane, runAdmitted(command, answer)),
    })
  })

  const run = ({
    command,
  }: Execution): Effect.Effect<
    Result.Result<CommandReceipt, AgentCommandFailure>,
    AgentCommandFailure
  > =>
    Match.value(command).pipe(
      Match.tags({ StartAgent: runLaunch, CreateWorktree: runLaunch }),
      Match.orElse(runOnPane),
    )

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
  static readonly layer = Layer.effect(this, make)
}
