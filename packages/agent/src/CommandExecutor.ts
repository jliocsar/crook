import * as Cache from 'effect/Cache'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'

import { AuditLog } from '@crook/agent/AuditLog'
import { CommandPolicy } from '@crook/agent/CommandPolicy'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { paneLabel } from '@crook/agent/MachineStateMapping'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import type { AgentRow } from '@crook/domain/AgentRow'
import {
  type Command,
  type CommandReceipt,
  InputDelivered,
  PaneClosed,
  PaneRenamed,
} from '@crook/domain/Command'
import type { IdempotencyKey } from '@crook/domain/Ids'
import { HerdrClient } from '@crook/herdr/HerdrClient'
import {
  AgentPromptMethod,
  AgentSendKeysMethod,
  PaneCloseMethod,
  PaneRenameMethod,
} from '@crook/herdr/Methods'
import {
  type AgentCommandFailure,
  CommandDeliveryUnknown,
  HerdrRefusedCommand,
  HerdrUnavailable,
  PaneNotAgent,
} from '@crook/protocol/Commands'

interface Execution {
  readonly key: IdempotencyKey
  readonly command: Command
}

const SLOWEST_MEASURED_PROMPT = Duration.millis(403)

export const COMMAND_REPLAY_CAPACITY = 1024
export const HERDR_DELIVERY_TIMEOUT = Duration.times(SLOWEST_MEASURED_PROMPT, 10)

const inputDelivered = (row: AgentRow): CommandReceipt =>
  new InputDelivered({ pane: row.pane, stateChangeSeq: row.stateChangeSeq })

const make = Effect.gen(function* () {
  const herdr = yield* HerdrClient
  const policy = yield* CommandPolicy
  const sync = yield* MachineStateSync
  const createdPanes = yield* CreatedPanes
  const audit = yield* AuditLog

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
