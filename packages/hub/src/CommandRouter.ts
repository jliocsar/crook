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
import type { MachineState } from '@crook/domain/MachineState'
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

interface Attachment {
  readonly link: number
  readonly outbox: Queue.Queue<RoutedCommand>
}

export interface LiveLink {
  readonly link: number
  readonly state: MachineState
}

export interface CommandLink {
  readonly attach: Stream.Stream<RoutedCommand>
  readonly published: (state: MachineState) => Effect.Effect<void>
}

interface PendingCommand {
  readonly machine: MachineId
  readonly reply: Deferred.Deferred<CommandReceipt, AgentCommandFailure>
}

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

const newestIn = (
  attachments: HashMap.HashMap<MachineId, readonly Attachment[]>,
  machine: MachineId,
) => pipe(HashMap.get(attachments, machine), Option.flatMap(Arr.last))

const make = Effect.gen(function* () {
  const attachments = yield* SubscriptionRef.make(HashMap.empty<MachineId, readonly Attachment[]>())
  const publishes = yield* SubscriptionRef.make(HashMap.empty<MachineId, LiveLink>())
  const nextLink = yield* Ref.make(0)
  const pending = yield* Ref.make(HashMap.empty<CommandId, PendingCommand>())
  const nextId = yield* Ref.make(0)

  const attachAs = (machine: MachineId, link: number) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const outbox = yield* Queue.unbounded<RoutedCommand>()
        const attachment: Attachment = { link, outbox }

        yield* Effect.acquireRelease(
          SubscriptionRef.update(
            attachments,
            HashMap.modifyAt(machine, withAttachment(attachment)),
          ),
          () =>
            Effect.andThen(
              SubscriptionRef.update(
                attachments,
                HashMap.modifyAt(machine, withoutAttachment(attachment)),
              ),
              Queue.shutdown(outbox),
            ),
        )

        return Stream.fromQueue(outbox)
      }),
    )

  const recordPublish = (machine: MachineId, link: number) => (state: MachineState) =>
    SubscriptionRef.update(
      publishes,
      HashMap.modifyAt(machine, (current) =>
        Option.exists(current, (newest) => newest.link > link)
          ? current
          : Option.some({ link, state }),
      ),
    )

  const linkFor = (machine: MachineId) =>
    Effect.map(
      Ref.getAndUpdate(nextLink, (current) => current + 1),
      (link): CommandLink => ({
        attach: attachAs(machine, link),
        published: recordPublish(machine, link),
      }),
    )

  const newestAttachment = (machine: MachineId) =>
    Effect.map(SubscriptionRef.get(attachments), (current) => newestIn(current, machine))

  const route = Effect.fn('CommandRouter.route')(function* (
    machine: MachineId,
    attachment: Option.Option<Attachment>,
    key: IdempotencyKey,
    command: Command,
  ) {
    const { outbox } = yield* Effect.fromOption(attachment, () => new MachineOffline({ machine }))
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

  const send = Effect.fn('CommandRouter.send')(function* (
    machine: MachineId,
    key: IdempotencyKey,
    command: Command,
  ) {
    return yield* route(machine, yield* newestAttachment(machine), key, command)
  })

  const sendOver = Effect.fn('CommandRouter.sendOver')(function* (
    machine: MachineId,
    link: number,
    key: IdempotencyKey,
    command: Command,
  ) {
    const newest = yield* newestAttachment(machine)

    return yield* route(
      machine,
      Option.filter(newest, (attachment) => attachment.link === link),
      key,
      command,
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

  const liveLink = (machine: MachineId) =>
    Stream.zipLatest(SubscriptionRef.changes(attachments), SubscriptionRef.changes(publishes)).pipe(
      Stream.map(([current, published]) =>
        Option.flatMap(newestIn(current, machine), ({ link }) =>
          Option.filter(HashMap.get(published, machine), (live) => live.link === link),
        ),
      ),
    )

  return CommandRouter.of({ linkFor, liveLink, send, sendOver, complete })
})

export class CommandRouter extends Context.Service<
  CommandRouter,
  {
    readonly linkFor: (machine: MachineId) => Effect.Effect<CommandLink>
    readonly liveLink: (machine: MachineId) => Stream.Stream<Option.Option<LiveLink>>
    readonly send: (
      machine: MachineId,
      key: IdempotencyKey,
      command: Command,
    ) => Effect.Effect<CommandReceipt, CommandFailure>
    readonly sendOver: (
      machine: MachineId,
      link: number,
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
