import { expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/testing/TestClock'

import type { HerdView } from '@crook/domain/HerdView'
import { MachineId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { Herd } from '@crook/hub/Herd'
import { MachineIdMismatch } from '@crook/protocol/AgentLink'

const LAPTOP = MachineId.make('laptop')
const WORK = MachineId.make('work')
const DETACH_AFTER = Duration.minutes(3)

const stateOf = (machine: MachineId, version: number) =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(version),
    workspaces: [],
    tabs: [],
    agents: [],
  })

const connectionOf = (view: HerdView, id: MachineId) =>
  Arr.findFirst(view.machines, (entry) => entry.machine.id === id).pipe(
    Option.map((entry) => entry.machine.connection),
  )

const viewWhere = Effect.fn('viewWhere')(function* (predicate: (view: HerdView) => boolean) {
  const herd = yield* Herd

  return yield* herd.view.pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
  )
})

const attach = Effect.fn('attach')(function* (id: MachineId) {
  const herd = yield* Herd

  return yield* Effect.forkChild(herd.hold(id), { startImmediately: true })
})

const currentView = viewWhere(() => true)

const withFreshHerd = <Success, Failure, Requirements>(
  test: Effect.Effect<Success, Failure, Requirements>,
) => Effect.flatMap(Layer.build(Herd.layer), (herd) => Effect.provide(test, herd))

it.effect('starts with no machines', () =>
  Effect.gen(function* () {
    expect((yield* currentView).machines).toEqual([])
  }).pipe(withFreshHerd),
)

it.effect('shows a machine offline, seen when its Attach ended, once the stream ends', () =>
  Effect.gen(function* () {
    const attachment = yield* attach(LAPTOP)

    expect(connectionOf(yield* currentView, LAPTOP)).toEqual(Option.some('online'))

    yield* TestClock.adjust(DETACH_AFTER)
    yield* Fiber.interrupt(attachment)
    const [laptop] = (yield* currentView).machines

    expect(laptop?.machine.connection).toBe('offline')
    expect(laptop?.machine.lastSeenAt).toEqual(DateTime.makeUnsafe(Duration.toMillis(DETACH_AFTER)))
  }).pipe(withFreshHerd),
)

it.effect('keeps a machine online until its last overlapping Attach ends', () =>
  Effect.gen(function* () {
    const stale = yield* attach(LAPTOP)
    const fresh = yield* attach(LAPTOP)

    yield* Fiber.interrupt(stale)

    expect(connectionOf(yield* currentView, LAPTOP)).toEqual(Option.some('online'))

    yield* Fiber.interrupt(fresh)

    expect(connectionOf(yield* currentView, LAPTOP)).toEqual(Option.some('offline'))
  }).pipe(withFreshHerd),
)

it.effect('keeps the last published state after the machine goes offline', () =>
  Effect.gen(function* () {
    const herd = yield* Herd
    const attachment = yield* attach(LAPTOP)

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1))
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2))
    yield* Fiber.interrupt(attachment)
    const [laptop] = (yield* currentView).machines

    expect(laptop?.machine.connection).toBe('offline')
    expect(laptop?.state).toEqual(Option.some(stateOf(LAPTOP, 2)))
  }).pipe(withFreshHerd),
)

it.effect('lists machines in id order', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 0))
    yield* herd.publish(WORK, stateOf(WORK, 0))
    const ids = (yield* currentView).machines.map((entry) => entry.machine.id)

    expect(ids).toEqual([LAPTOP, WORK])
  }).pipe(withFreshHerd),
)

it.effect('rejects state published for a machine other than the connected one', () =>
  Effect.gen(function* () {
    const herd = yield* Herd
    const mismatch = yield* herd.publish(LAPTOP, stateOf(WORK, 0)).pipe(Effect.flip)

    expect(mismatch).toEqual(
      new MachineIdMismatch({ connectedMachine: LAPTOP, publishedMachine: WORK }),
    )
    expect((yield* currentView).machines).toEqual([])
  }).pipe(withFreshHerd),
)
