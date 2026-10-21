import { expect, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/testing/TestClock'

import { InputDelivered, Prompt } from '@crook/domain/Command'
import { IdempotencyKey, MachineId, PaneId, TerminalId } from '@crook/domain/Ids'
import { CommandRouter } from '@crook/hub/CommandRouter'
import { COMMAND_TIMEOUT } from '@crook/protocol/AgentLink'
import {
  CommandTimedOut,
  MachineOffline,
  PaneNotAgent,
  type RoutedCommand,
} from '@crook/protocol/Commands'

const LAPTOP = MachineId.make('laptop')
const WORK = MachineId.make('work')
const PANE = PaneId.make('w1:p1')
const ACTION = IdempotencyKey.make('3f1c8a52-0b7e-4d0a-9a51-6f3f0d2f8e11')

const continuePrompt = new Prompt({ pane: PANE, text: 'continue' })
const delivered = new InputDelivered({
  pane: PANE,
  terminal: TerminalId.make('term_1'),
  stateChangeSeq: 4,
})

const startRouter = Effect.map(Layer.build(CommandRouter.layer), (context) =>
  Context.get(context, CommandRouter),
)

const attachAgent = Effect.fn('attachAgent')(function* (
  router: CommandRouter['Service'],
  machine: MachineId,
) {
  const inbox = yield* Queue.unbounded<RoutedCommand>()
  const attachment = yield* router.attach(machine).pipe(
    Stream.runForEach((routed) => Queue.offer(inbox, routed)),
    Effect.forkChild({ startImmediately: true }),
  )

  return { inbox, detach: Fiber.interrupt(attachment) }
})

const sendInBackground = (router: CommandRouter['Service'], machine: MachineId) =>
  Effect.forkChild(router.send(machine, ACTION, continuePrompt), { startImmediately: true })

it.effect('fails with MachineOffline when the machine has no Attach open', () =>
  Effect.gen(function* () {
    const router = yield* startRouter
    const offline = yield* router.send(LAPTOP, ACTION, continuePrompt).pipe(Effect.flip)

    expect(offline).toEqual(new MachineOffline({ machine: LAPTOP }))
  }),
)

it.effect('routes the command down Attach and answers with the agent receipt', () =>
  Effect.gen(function* () {
    const router = yield* startRouter
    const agent = yield* attachAgent(router, LAPTOP)
    const sending = yield* sendInBackground(router, LAPTOP)
    const routed = yield* Queue.take(agent.inbox)

    yield* router.complete(LAPTOP, routed.id, Result.succeed(delivered))

    expect(routed.key).toBe(ACTION)
    expect(routed.command).toEqual(continuePrompt)
    expect(yield* Fiber.join(sending)).toEqual(delivered)
  }),
)

it.effect('fails with the failure the agent answers with', () =>
  Effect.gen(function* () {
    const router = yield* startRouter
    const agent = yield* attachAgent(router, LAPTOP)
    const sending = yield* sendInBackground(router, LAPTOP)
    const routed = yield* Queue.take(agent.inbox)

    yield* router.complete(LAPTOP, routed.id, Result.fail(new PaneNotAgent({ pane: PANE })))

    expect(yield* Fiber.join(sending).pipe(Effect.flip)).toEqual(new PaneNotAgent({ pane: PANE }))
  }),
)

it.effect('times out when the agent never answers, and drops the late answer', () =>
  Effect.gen(function* () {
    const router = yield* startRouter
    const agent = yield* attachAgent(router, LAPTOP)
    const sending = yield* sendInBackground(router, LAPTOP)
    const routed = yield* Queue.take(agent.inbox)

    yield* TestClock.adjust(COMMAND_TIMEOUT)
    const timedOut = yield* Fiber.join(sending).pipe(Effect.flip)
    const resending = yield* sendInBackground(router, LAPTOP)
    const rerouted = yield* Queue.take(agent.inbox)

    yield* router.complete(LAPTOP, routed.id, Result.succeed(delivered))
    yield* router.complete(LAPTOP, rerouted.id, Result.fail(new PaneNotAgent({ pane: PANE })))

    expect(timedOut).toEqual(new CommandTimedOut({ machine: LAPTOP, timeout: COMMAND_TIMEOUT }))
    expect(yield* Fiber.join(resending).pipe(Effect.flip)).toEqual(new PaneNotAgent({ pane: PANE }))
  }),
)

it.effect('ignores an answer sent by a machine the command was not routed to', () =>
  Effect.gen(function* () {
    const router = yield* startRouter
    const agent = yield* attachAgent(router, LAPTOP)

    yield* attachAgent(router, WORK)
    const sending = yield* sendInBackground(router, LAPTOP)
    const routed = yield* Queue.take(agent.inbox)

    yield* router.complete(WORK, routed.id, Result.fail(new PaneNotAgent({ pane: PANE })))
    yield* router.complete(LAPTOP, routed.id, Result.succeed(delivered))

    expect(yield* Fiber.join(sending)).toEqual(delivered)
  }),
)

it.effect('routes to the newest Attach while an older one is still closing', () =>
  Effect.gen(function* () {
    const router = yield* startRouter
    const older = yield* attachAgent(router, LAPTOP)
    const newer = yield* attachAgent(router, LAPTOP)

    yield* sendInBackground(router, LAPTOP)
    const routed = yield* Queue.take(newer.inbox)

    expect(routed.command).toEqual(continuePrompt)
    expect(yield* Queue.size(older.inbox)).toBe(0)
  }),
)

it.effect('is offline again once the last Attach of a machine ends', () =>
  Effect.gen(function* () {
    const router = yield* startRouter
    const agent = yield* attachAgent(router, LAPTOP)

    yield* agent.detach
    const offline = yield* router.send(LAPTOP, ACTION, continuePrompt).pipe(Effect.flip)

    expect(offline).toEqual(new MachineOffline({ machine: LAPTOP }))
  }),
)
