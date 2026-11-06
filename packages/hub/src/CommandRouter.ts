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
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { Command, CommandReceipt } from '@crook/domain/Command'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import { commandTimeout } from '@crook/protocol/AgentLink'
import {
  type AgentCommandFailure,
  CommandId,
  type CommandFailure,
  type CommandResult,
  CommandTimedOut,
  MachineOffline,
  RoutedCommand,
} from '@crook/protocol/Commands'

type Outbox = Queue.Queue<RoutedCommand>

interface PendingCommand {
  readonly machine: MachineId
  readonly reply: Deferred.Deferred<CommandReceipt, AgentCommandFailure>
}

const withOutbox =
  (outbox: Outbox) =>
  (current: Option.Option<readonly Outbox[]>): Option.Option<readonly Outbox[]> =>
    Option.some(Arr.append(Option.getOrElse(current, Arr.empty), outbox))

const withoutOutbox =
  (outbox: Outbox) =>
  (current: Option.Option<readonly Outbox[]>): Option.Option<readonly Outbox[]> =>
    Option.flatMap(current, (attached) =>
      Option.liftPredicate(
        Arr.filter(attached, (entry) => entry !== outbox),
        Arr.isReadonlyArrayNonEmpty,
      ),
    )

const make = Effect.gen(function* () {
  const attachments = yield* SubscriptionRef.make(HashMap.empty<MachineId, readonly Outbox[]>())
  const pending = yield* Ref.make(HashMap.empty<CommandId, PendingCommand>())
  const nextId = yield* Ref.make(0)

  const attach = (machine: MachineId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const outbox = yield* Queue.unbounded<RoutedCommand>()

        yield* Effect.acquireRelease(
          SubscriptionRef.update(attachments, HashMap.modifyAt(machine, withOutbox(outbox))),
          () =>
            Effect.andThen(
              SubscriptionRef.update(attachments, HashMap.modifyAt(machine, withoutOutbox(outbox))),
              Queue.shutdown(outbox),
            ),
        )

        return Stream.fromQueue(outbox)
      }),
    )

  const newestOutbox = (machine: MachineId) =>
    Effect.flatMap(SubscriptionRef.get(attachments), (current) =>
      Effect.fromOption(
        pipe(HashMap.get(current, machine), Option.flatMap(Arr.last)),
        () => new MachineOffline({ machine }),
      ),
    )

  const send = Effect.fn('CommandRouter.send')(function* (
    machine: MachineId,
    key: IdempotencyKey,
    command: Command,
  ) {
    const outbox = yield* newestOutbox(machine)
    const id = CommandId.make(yield* Ref.getAndUpdate(nextId, (current) => current + 1))
    const reply = yield* Deferred.make<CommandReceipt, AgentCommandFailure>()
    const timeout = commandTimeout(command)

    return yield* Effect.acquireUseRelease(
      Ref.update(pending, HashMap.set(id, { machine, reply })),
      () =>
        Queue.offer(outbox, new RoutedCommand({ id, key, command })).pipe(
          Effect.filterOrFail(
            (offered) => offered,
            () => new MachineOffline({ machine }),
          ),
          Effect.andThen(Deferred.await(reply)),
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () => Effect.fail(new CommandTimedOut({ machine, timeout })),
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

  const attached = (machine: MachineId) =>
    SubscriptionRef.changes(attachments).pipe(Stream.map(HashMap.has(machine)))

  return CommandRouter.of({ attach, attached, send, complete })
})

export class CommandRouter extends Context.Service<
  CommandRouter,
  {
    readonly attach: (machine: MachineId) => Stream.Stream<RoutedCommand>
    readonly attached: (machine: MachineId) => Stream.Stream<boolean>
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
