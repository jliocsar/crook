import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'

import type { Command, CommandReceipt } from '@crook/domain/Command'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import { AGENT_PING_INTERVAL } from '@crook/protocol/AgentLink'
import {
  type AgentCommandFailure,
  CommandId,
  type CommandFailure,
  type CommandResult,
  CommandTimedOut,
  MachineOffline,
  RoutedCommand,
} from '@crook/protocol/Commands'

interface Attachment {
  readonly outbox: Queue.Queue<RoutedCommand>
}

interface PendingCommand {
  readonly machine: MachineId
  readonly reply: Deferred.Deferred<CommandReceipt, AgentCommandFailure>
}

export const COMMAND_TIMEOUT = AGENT_PING_INTERVAL

const withAttachment =
  (attachment: Attachment) =>
  (current: Option.Option<readonly Attachment[]>): Option.Option<readonly Attachment[]> =>
    Option.some(Arr.append(Option.getOrElse(current, Arr.empty), attachment))

const withoutAttachment =
  (attachment: Attachment) =>
  (current: Option.Option<readonly Attachment[]>): Option.Option<readonly Attachment[]> =>
    Option.flatMap(current, (attached) =>
      Option.liftPredicate(
        Arr.filter(attached, (entry) => entry !== attachment),
        Arr.isReadonlyArrayNonEmpty,
      ),
    )

const make = Effect.gen(function* () {
  const attachments = yield* Ref.make(HashMap.empty<MachineId, readonly Attachment[]>())
  const pending = yield* Ref.make(HashMap.empty<CommandId, PendingCommand>())
  const nextId = yield* Ref.make(0)

  const attach = (machine: MachineId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const attachment: Attachment = { outbox: yield* Queue.unbounded<RoutedCommand>() }

        yield* Effect.acquireRelease(
          Ref.update(attachments, HashMap.modifyAt(machine, withAttachment(attachment))),
          () =>
            Effect.andThen(
              Ref.update(attachments, HashMap.modifyAt(machine, withoutAttachment(attachment))),
              Queue.shutdown(attachment.outbox),
            ),
        )

        return Stream.fromQueue(attachment.outbox)
      }),
    )

  const newestOutbox = (machine: MachineId) =>
    Effect.map(Ref.get(attachments), (current) =>
      pipe(
        HashMap.get(current, machine),
        Option.flatMap(Arr.last),
        Option.map((attachment) => attachment.outbox),
      ),
    ).pipe(
      Effect.flatMap((outbox) => Effect.fromOption(outbox, () => new MachineOffline({ machine }))),
    )

  const send = Effect.fn('CommandRouter.send')(function* (
    machine: MachineId,
    key: IdempotencyKey,
    command: Command,
  ) {
    const outbox = yield* newestOutbox(machine)
    const id = CommandId.make(yield* Ref.getAndUpdate(nextId, (current) => current + 1))
    const reply = yield* Deferred.make<CommandReceipt, AgentCommandFailure>()

    return yield* Effect.acquireUseRelease(
      Ref.update(pending, HashMap.set(id, { machine, reply })),
      () =>
        Queue.offer(outbox, new RoutedCommand({ id, key, command })).pipe(
          Effect.andThen(Deferred.await(reply)),
          Effect.timeoutOrElse({
            duration: COMMAND_TIMEOUT,
            orElse: () => Effect.fail(new CommandTimedOut({ machine, timeout: COMMAND_TIMEOUT })),
          }),
        ),
      () => Ref.update(pending, HashMap.remove(id)),
    )
  })

  const complete = Effect.fn('CommandRouter.complete')(function* (
    machine: MachineId,
    id: CommandId,
    result: CommandResult,
  ) {
    const waiting = HashMap.get(yield* Ref.get(pending), id).pipe(
      Option.filter((entry) => entry.machine === machine),
    )

    yield* Option.match(waiting, {
      onNone: () =>
        Effect.logDebug(
          `Dropped the answer to command ${id}: nobody waits for it on this machine any more, most likely because it timed out.`,
        ),
      onSome: (entry) => Deferred.completeWith(entry.reply, Effect.fromResult(result)),
    })
  })

  return CommandRouter.of({ attach, send, complete })
})

export class CommandRouter extends Context.Service<
  CommandRouter,
  {
    readonly attach: (machine: MachineId) => Stream.Stream<RoutedCommand>
    readonly send: (
      machine: MachineId,
      key: IdempotencyKey,
      command: Command,
    ) => Effect.Effect<CommandReceipt, CommandFailure>
    readonly complete: (
      machine: MachineId,
      id: CommandId,
      result: CommandResult,
    ) => Effect.Effect<void>
  }
>()('@crook/hub/CommandRouter') {
  static readonly layer = Layer.effect(this, make)
}
