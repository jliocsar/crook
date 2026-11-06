import { expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Result from 'effect/Result'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/testing/TestClock'

import { InputDelivered, Prompt, StartAgent } from '@crook/domain/Command'
import { IdempotencyKey, MachineId, PaneId, TerminalId } from '@crook/domain/Ids'
import { CommandRouter } from '@crook/hub/CommandRouter'
import { COMMAND_TIMEOUT, LAUNCH_COMMAND_TIMEOUT } from '@crook/protocol/AgentLink'
import {
  CommandTimedOut,
  MachineOffline,
  PaneNotAgent,
  type RoutedCommand,
} from '@crook/protocol/Commands'

import { machineStateWith } from './Fixtures'

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

const ANY_STATE = machineStateWith(LAPTOP, 1, [])
const LATER_STATE = machineStateWith(LAPTOP, 2, [])

const startRouter = Effect.map(Layer.build(CommandRouter.layer), (context) =>
  Context.get(context, CommandRouter),
)

const attachAgent = Effect.fn('attachAgent')(function* (
  router: CommandRouter['Service'],
  machine: MachineId,
) {
  const inbox = yield* Queue.unbounded<RoutedCommand>()
  const link = yield* router.linkFor(machine)
  const attachment = yield* link.attach.pipe(
    Stream.runForEach((routed) => Queue.offer(inbox, routed)),
    Effect.forkChild({ startImmediately: true }),
  )

  return { inbox, detach: Fiber.interrupt(attachment) }
})

const liveLinkNow = (router: CommandRouter['Service']) =>
  router.liveLink(LAPTOP).pipe(Stream.runHead, Effect.map(Option.flatten))

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

it.effect('waits for a launch as long as starting an agent and handing it its task can take', () =>
  Effect.gen(function* () {
    const router = yield* startRouter
    yield* attachAgent(router, LAPTOP)
    const start = new StartAgent({
      kind: 'claude',
      folder: '/home/jliocsar/Projects/crook',
      task: Option.none(),
    })
    const sending = yield* Effect.forkChild(router.send(LAPTOP, ACTION, start), {
      startImmediately: true,
    })

    yield* TestClock.adjust(COMMAND_TIMEOUT)
    const pendingAfterInputTimeout = sending.pollUnsafe()

    yield* TestClock.adjust(Duration.subtract(LAUNCH_COMMAND_TIMEOUT, COMMAND_TIMEOUT))

    expect(pendingAfterInputTimeout).toBeUndefined()
    expect(yield* Fiber.join(sending).pipe(Effect.flip)).toEqual(
      new CommandTimedOut({ machine: LAPTOP, timeout: LAUNCH_COMMAND_TIMEOUT }),
    )
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

it.effect('sends over a judged link only while it is still the newest', () =>
  Effect.gen(function* () {
    const router = yield* startRouter
    const older = yield* router.linkFor(LAPTOP)
    const newer = yield* router.linkFor(LAPTOP)

    yield* Effect.forkChild(Stream.runDrain(older.attach), { startImmediately: true })
    yield* older.publish(ANY_STATE, Effect.void)
    const judged = Option.getOrThrow(yield* liveLinkNow(router))

    yield* Effect.forkChild(Stream.runDrain(newer.attach), { startImmediately: true })
    const refused = yield* router
      .sendOver(LAPTOP, judged.link, ACTION, continuePrompt)
      .pipe(Effect.flip)

    expect(refused).toEqual(new MachineOffline({ machine: LAPTOP }))
  }),
)

it.effect(
  'reads a state live only on the newest link, in either order and despite a late one',
  () =>
    Effect.gen(function* () {
      const router = yield* startRouter
      const older = yield* router.linkFor(LAPTOP)
      const newer = yield* router.linkFor(LAPTOP)
      const liveNow = liveLinkNow(router)
      const olderAttachment = yield* Effect.forkChild(Stream.runDrain(older.attach), {
        startImmediately: true,
      })
      const beforeAnyState = yield* liveNow

      yield* older.publish(ANY_STATE, Effect.void)
      const onItsLink = yield* liveNow

      yield* newer.publish(LATER_STATE, Effect.void)
      const notAttachedYet = yield* liveNow

      yield* Effect.forkChild(Stream.runDrain(newer.attach), { startImmediately: true })
      const onceAttached = yield* liveNow

      yield* older.publish(ANY_STATE, Effect.void)
      const afterALatePublish = yield* liveNow

      yield* Fiber.interrupt(olderAttachment)
      const afterTheOldLinkEnds = yield* liveNow

      expect(Option.isNone(beforeAnyState)).toBe(true)
      expect(Option.map(onItsLink, (live) => live.state)).toEqual(Option.some(ANY_STATE))
      expect(Option.isNone(notAttachedYet)).toBe(true)
      expect(Option.map(onceAttached, (live) => live.state)).toEqual(Option.some(LATER_STATE))
      expect(Option.map(afterALatePublish, (live) => live.state)).toEqual(Option.some(LATER_STATE))
      expect(Option.map(afterTheOldLinkEnds, (live) => live.state)).toEqual(
        Option.some(LATER_STATE),
      )
    }),
)

const publishLog = Effect.map(Ref.make<readonly string[]>([]), (written) => ({
  written,
  write: (name: string) => Ref.update(written, Arr.append(name)),
}))

it.effect(
  'runs a state from the link that published last and a later one, and drops an older one',
  () =>
    Effect.gen(function* () {
      const router = yield* startRouter
      const { written, write } = yield* publishLog
      const older = yield* router.linkFor(LAPTOP)
      const newer = yield* router.linkFor(LAPTOP)

      yield* older.publish(ANY_STATE, write('older first'))
      yield* older.publish(LATER_STATE, write('older second'))
      yield* newer.publish(ANY_STATE, write('first on newer'))
      yield* older.publish(LATER_STATE, write('late on older'))
      yield* newer.publish(LATER_STATE, write('second on newer'))

      expect(yield* Ref.get(written)).toEqual([
        'older first',
        'older second',
        'first on newer',
        'second on newer',
      ])
    }),
)

it.effect('fences nothing for a link that has not published, or a failed write', () =>
  Effect.gen(function* () {
    const router = yield* startRouter
    const { written, write } = yield* publishLog
    const older = yield* router.linkFor(LAPTOP)
    const newer = yield* router.linkFor(LAPTOP)
    const other = yield* router.linkFor(WORK)

    yield* newer.publish(ANY_STATE, Effect.fail('refused')).pipe(Effect.flip)
    yield* older.publish(ANY_STATE, write('older'))
    yield* other.publish(machineStateWith(WORK, 1, []), write('other machine'))

    expect(yield* Ref.get(written)).toEqual(['older', 'other machine'])
  }),
)

it.effect('drops an older state that waits while a newer link writes', () =>
  Effect.gen(function* () {
    const router = yield* startRouter
    const { written, write } = yield* publishLog
    const older = yield* router.linkFor(LAPTOP)
    const newer = yield* router.linkFor(LAPTOP)
    const finishWrite = yield* Deferred.make<void>()
    const writing = yield* newer
      .publish(ANY_STATE, Effect.andThen(Deferred.await(finishWrite), write('newer')))
      .pipe(Effect.forkChild({ startImmediately: true }))
    const late = yield* older
      .publish(LATER_STATE, write('late on older'))
      .pipe(Effect.forkChild({ startImmediately: true }))

    yield* Deferred.succeed(finishWrite, undefined)
    yield* Fiber.join(writing)
    yield* Fiber.join(late)

    expect(yield* Ref.get(written)).toEqual(['newer'])
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
