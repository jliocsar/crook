import type * as Cause from 'effect/Cause'
import type * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Latch from 'effect/Latch'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { PaneClosed, PaneRenamed } from '@crook/domain/Command'
import type { Command, CommandReceipt } from '@crook/domain/Command'
import type { HerdView } from '@crook/domain/HerdView'
import type { IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'
import type { CommandFailure } from '@crook/protocol/Commands'
import { HerdCache } from '@crook/web/cache/HerdCache'
import type { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubConnection } from '@crook/web/rpc/HubConnection'
import type {
  ForgetMachineRefused,
  HubCallFailed,
  SetPinnedRefused,
} from '@crook/web/rpc/HubConnection'
import { HubLink } from '@crook/web/rpc/HubLink'
import type { HubNotConnected } from '@crook/web/rpc/HubLink'
import type { HubLinkState } from '@crook/web/rpc/HubLinkState'
import { PageSignals } from '@crook/web/rpc/PageSignals'
import { SessionCheck } from '@crook/web/rpc/SessionCheck'

export interface FakeSession {
  readonly views: Queue.Queue<HerdView, HubCallFailed | Cause.Done>
}

export interface SeenCall {
  readonly machine: MachineId
  readonly pane: PaneId
}

export interface PinCall {
  readonly machine: MachineId
  readonly pane: PaneId
  readonly pinned: boolean
}

export interface SentCommand {
  readonly machine: MachineId
  readonly key: IdempotencyKey
  readonly command: Command
}

export type FakeCommandRefusal = CommandFailure | HubCallFailed | HubNotConnected

const NO_COMMAND_ANSWER = Exit.die(
  new Error('This test sent a command without setting its answer.'),
)

const receiptFor = (command: Command): Option.Option<CommandReceipt> =>
  Match.value(command).pipe(
    Match.tags({
      RenameAgent: (rename) =>
        Option.some<CommandReceipt>(new PaneRenamed({ pane: rename.pane, label: rename.label })),
      ClosePane: (close) => Option.some<CommandReceipt>(new PaneClosed({ pane: close.pane })),
    }),
    Match.orElse(() => Option.none()),
  )

export const makeFakeBrowser = Effect.fn('makeFakeBrowser')(function* (
  cached: Option.Option<HerdSnapshot>,
) {
  const sessions = yield* Queue.unbounded<FakeSession>()
  const opened = yield* Ref.make(0)
  const closed = yield* Ref.make(0)
  const seen = yield* Ref.make<readonly SeenCall[]>([])
  const forgotten = yield* Ref.make<readonly MachineId[]>([])
  const sent = yield* Ref.make<readonly SentCommand[]>([])
  const commandAnswer =
    yield* Ref.make<Exit.Exit<CommandReceipt, CommandFailure | HubCallFailed>>(NO_COMMAND_ANSWER)
  const saved = yield* Ref.make(cached)
  const visible = yield* SubscriptionRef.make(true)
  const online = yield* SubscriptionRef.make(true)
  const expired = yield* Ref.make(false)
  const sessionCheckTakes = yield* Ref.make(Option.none<Duration.Duration>())

  const open = Effect.gen(function* () {
    const views = yield* Queue.unbounded<HerdView, HubCallFailed | Cause.Done>()

    yield* Ref.update(opened, (count) => count + 1)
    yield* Effect.addFinalizer(() => Ref.update(closed, (count) => count + 1))
    yield* Queue.offer(sessions, { views })

    return {
      watchHerd: Stream.fromQueue(views),
      markSeen: (machine: MachineId, pane: PaneId) =>
        Ref.update(seen, (calls) => [...calls, { machine, pane }]),
      forgetMachine: (machine: MachineId) =>
        Ref.update(forgotten, (machines) => [...machines, machine]),
      setPinned: () => Effect.void,
      sendCommand: (machine: MachineId, key: IdempotencyKey, command: Command) =>
        Effect.andThen(
          Ref.update(sent, (commands) => [...commands, { machine, key, command }]),
          Effect.flatten(Ref.get(commandAnswer)),
        ),
    }
  })

  const layer = Layer.mergeAll(
    Layer.succeed(HubConnection, HubConnection.of({ open })),
    Layer.succeed(
      HerdCache,
      HerdCache.of({
        load: Ref.get(saved),
        save: (snapshot) => Ref.set(saved, Option.some(snapshot)),
      }),
    ),
    Layer.succeed(
      PageSignals,
      PageSignals.of({
        visible: SubscriptionRef.changes(visible),
        online: SubscriptionRef.changes(online),
      }),
    ),
    Layer.succeed(
      SessionCheck,
      SessionCheck.of({
        expired: Effect.andThen(
          Effect.flatMap(
            Ref.get(sessionCheckTakes),
            Option.match({ onNone: () => Effect.void, onSome: Effect.sleep }),
          ),
          Ref.get(expired),
        ),
      }),
    ),
  )

  return {
    layer,
    sessions,
    opened,
    closed,
    seen,
    forgotten,
    sent,
    commandAnswer,
    saved,
    visible,
    online,
    expired,
    sessionCheckTakes,
  }
})

export const makeFakeHubLink = Effect.fn('makeFakeHubLink')(function* (initial: HubLinkState) {
  const state = yield* SubscriptionRef.make(initial)
  const seen = yield* Ref.make<readonly SeenCall[]>([])
  const resyncs = yield* Ref.make(0)
  const forgotten = yield* Ref.make<readonly MachineId[]>([])
  const forgetRefusal = yield* Ref.make(
    Option.none<ForgetMachineRefused | HubCallFailed | HubNotConnected>(),
  )
  const forgetAnswers = yield* Latch.make(true)
  const pins = yield* Ref.make<readonly PinCall[]>([])
  const pinRefusal = yield* Ref.make(
    Option.none<SetPinnedRefused | HubCallFailed | HubNotConnected>(),
  )
  const sent = yield* Ref.make<readonly SentCommand[]>([])
  const commandAnswer =
    yield* Ref.make<Exit.Exit<CommandReceipt, CommandFailure | HubCallFailed | HubNotConnected>>(
      NO_COMMAND_ANSWER,
    )
  const commandRefusals = yield* Ref.make<readonly FakeCommandRefusal[]>([])
  const commandAnswers = yield* Latch.make(true)

  const nextRefusal = Ref.modify(
    commandRefusals,
    (refusals): [Option.Option<FakeCommandRefusal>, readonly FakeCommandRefusal[]] => [
      Option.fromUndefinedOr(refusals[0]),
      refusals.slice(1),
    ],
  )

  const layer = Layer.succeed(
    HubLink,
    HubLink.of({
      changes: SubscriptionRef.changes(state),
      resync: Ref.update(resyncs, (count) => count + 1),
      markSeen: (machine, pane) => Ref.update(seen, (calls) => [...calls, { machine, pane }]),
      forgetMachine: (machine) =>
        Effect.andThen(
          forgetAnswers.await,
          Effect.flatMap(
            Ref.get(forgetRefusal),
            Option.match({
              onNone: () => Ref.update(forgotten, (machines) => [...machines, machine]),
              onSome: Effect.fail,
            }),
          ),
        ),
      setPinned: (machine, pane, pinned) =>
        Effect.andThen(
          Ref.update(pins, (calls) => [...calls, { machine, pane, pinned }]),
          Effect.flatMap(
            Ref.get(pinRefusal),
            Option.match({ onNone: () => Effect.void, onSome: Effect.fail }),
          ),
        ),
      sendCommand: (machine, key, command) =>
        Effect.andThen(
          Ref.update(sent, (commands) => [...commands, { machine, key, command }]),
          Effect.andThen(
            commandAnswers.await,
            Effect.flatMap(
              nextRefusal,
              Option.match({
                onNone: () =>
                  Option.match(receiptFor(command), {
                    onNone: () => Effect.flatten(Ref.get(commandAnswer)),
                    onSome: Effect.succeed,
                  }),
                onSome: Effect.fail,
              }),
            ),
          ),
        ),
    }),
  )

  return {
    layer,
    state,
    seen,
    resyncs,
    forgotten,
    forgetRefusal,
    forgetAnswers,
    pins,
    pinRefusal,
    sent,
    commands: sent,
    commandAnswer,
    commandRefusals,
    commandAnswers,
  }
})

export const dropSession = (session: FakeSession, error: HubCallFailed) =>
  Queue.fail(session.views, error)
