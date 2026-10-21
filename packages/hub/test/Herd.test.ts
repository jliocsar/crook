import { expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import { SqlError, UnknownError } from 'effect/sql/SqlError'
import * as Stream from 'effect/Stream'
import * as TestClock from 'effect/testing/TestClock'

import { AgentRow, StatusBeforeHandoff } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import type { HerdMachine, HerdView } from '@crook/domain/HerdView'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  HerdrConnectionId,
  MachineId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import * as Database from '@crook/hub/Database'
import { Herd, RECONNECT_GRACE, hubVersion } from '@crook/hub/Herd'
import { MachineRegistry } from '@crook/hub/MachineRegistry'
import { PinnedAgents } from '@crook/hub/PinnedAgents'
import { SeenTracker } from '@crook/hub/SeenTracker'
import { Hello, MachineIdMismatch } from '@crook/protocol/AgentLink'
import { MachineNotInHerd, MachineStillConnected, PaneNotInHerd } from '@crook/protocol/ClientApi'

import packageJson from '../package.json' with { type: 'json' }

const IN_MEMORY = ':memory:'
const LAPTOP = MachineId.make('laptop')
const WORK = MachineId.make('work')
const PANE = PaneId.make('w1:p1')
const OTHER_PANE = PaneId.make('w1:p2')
const DETACH_AFTER = Duration.minutes(3)
const BEFORE_GRACE_ENDS = Duration.seconds(1)
const DISK_FULL = 'database or disk is full'
const BEFORE_HANDOFF = TerminalId.make('term_65e4959ec32112')
const AFTER_HANDOFF = TerminalId.make('term_65e4981ac9ff02')

const hello = new Hello({ agentVersion: '0.0.9', label: Option.none() })

const agentAt = (pane: PaneId, stateChangeSeq: number, terminal: TerminalId = BEFORE_HANDOFF) =>
  new AgentRow({
    pane,
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    terminal,
    status: 'done',
    title: 'EX-253 Example feature',
    label: Option.none(),
    createdByCrook: false,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq,
    statusChangedAt: DateTime.makeUnsafe(0),
    beforeHandoff: Option.none(),
  })

const handedOffAt = (stateChangeSeq: number, status: AgentStatus) =>
  new AgentRow({
    pane: PANE,
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    terminal: AFTER_HANDOFF,
    status,
    title: 'EX-253 Example feature',
    label: Option.none(),
    createdByCrook: false,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq,
    statusChangedAt: DateTime.makeUnsafe(0),
    beforeHandoff: Option.some(
      new StatusBeforeHandoff({
        status: 'done',
        statusChangedAt: DateTime.makeUnsafe(0),
        terminal: BEFORE_HANDOFF,
        stateChangeSeq: 5,
      }),
    ),
  })

const stateOf = (
  machine: MachineId,
  version: number,
  agents: readonly AgentRow[] = [],
  connection = 1,
) =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(version),
    herdrVersion: '0.9.1',
    herdr: new HerdrLink({ connection: HerdrConnectionId.make(connection), lostAt: Option.none() }),
    workspaces: [],
    tabs: [],
    panes: [],
    agents,
  })

const machineIn = (view: HerdView, id: MachineId) =>
  Arr.findFirst(view.machines, (entry) => entry.machine.id === id)

const connectionOf = (view: HerdView, id: MachineId) =>
  Option.map(machineIn(view, id), (entry) => entry.machine.connection)

const seenOf = (view: HerdView, id: MachineId) =>
  Option.map(machineIn(view, id), (entry: HerdMachine) => entry.seen)

const pinnedOf = (view: HerdView, id: MachineId) =>
  Option.map(machineIn(view, id), (entry: HerdMachine) => entry.pinned)

const viewWhere = Effect.fn('viewWhere')(function* (predicate: (view: HerdView) => boolean) {
  const herd = yield* Herd

  return yield* herd.view.pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.flatMap(Effect.fromOption),
  )
})

const currentView = viewWhere(() => true)

const attach = Effect.fn('attach')(function* (id: MachineId, greeting: Hello = hello) {
  const herd = yield* Herd

  return yield* Effect.forkScoped(herd.hold(id, greeting), { startImmediately: true })
})

const withFreshHerd = <Success, Failure, Requirements>(
  test: Effect.Effect<Success, Failure, Requirements>,
) =>
  Effect.scoped(
    Effect.flatMap(
      Layer.build(Layer.provideMerge(Herd.layer, Database.layerAt(IN_MEMORY))),
      (context) => Effect.provide(test, context),
    ),
  )

const storageRefused = new SqlError({
  reason: new UnknownError({ cause: DISK_FULL, message: DISK_FULL }),
})

const refusingRegistry = Layer.succeed(
  MachineRegistry,
  MachineRegistry.of({ all: Effect.succeed([]), save: () => Effect.fail(storageRefused) }),
)

const refusingStorage = Layer.mergeAll(
  refusingRegistry,
  Layer.succeed(
    SeenTracker,
    SeenTracker.of({
      all: Effect.succeed([]),
      mark: () => Effect.fail(storageRefused),
      dropPanes: () => Effect.fail(storageRefused),
    }),
  ),
  Layer.succeed(
    PinnedAgents,
    PinnedAgents.of({
      all: Effect.succeed([]),
      pin: () => Effect.fail(storageRefused),
      unpin: () => Effect.fail(storageRefused),
    }),
  ),
)

const withRefusingRegistry = <Success, Failure, Requirements>(
  test: Effect.Effect<Success, Failure, Requirements>,
) =>
  Effect.scoped(
    Effect.flatMap(
      Layer.build(
        Layer.provideMerge(
          Herd.layerWithoutDependencies,
          Layer.provide(
            Layer.mergeAll(refusingRegistry, SeenTracker.layer, PinnedAgents.layer),
            Database.layerAt(IN_MEMORY),
          ),
        ),
      ),
      (context) => Effect.provide(test, context),
    ),
  )

const withRefusingStorage = <Success, Failure, Requirements>(
  test: Effect.Effect<Success, Failure, Requirements>,
) =>
  Effect.scoped(
    Effect.flatMap(
      Layer.build(Layer.provide(Herd.layerWithoutDependencies, refusingStorage)),
      (context) => Effect.provide(test, context),
    ),
  )

const restartingHerd = Effect.fn('restartingHerd')(function* () {
  const database = yield* Layer.build(Database.layerAt(IN_MEMORY))
  const run = <Success, Failure, Requirements>(
    test: Effect.Effect<Success, Failure, Requirements>,
  ) =>
    Effect.scoped(
      Effect.flatMap(
        Layer.build(Layer.provide(Herd.layer, Layer.succeedContext(database))),
        (herd) => Effect.provide(test, herd),
      ),
    )

  return { run, database }
})

it.effect('starts with no machines, and reports its own version', () =>
  Effect.gen(function* () {
    const view = yield* currentView

    expect(view.machines).toEqual([])
    expect(view.hubVersion).toBe(packageJson.version)
    expect(hubVersion).toBe(packageJson.version)
  }).pipe(withFreshHerd),
)

it.effect('shows an attached machine online since it attached, with the hello versions', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* TestClock.adjust(DETACH_AFTER)
    yield* attach(LAPTOP, new Hello({ agentVersion: '0.1.0', label: Option.some('Laptop') }))
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1))
    const laptop = yield* Effect.fromOption(machineIn(yield* currentView, LAPTOP))

    expect(laptop.machine.connection).toBe('online')
    expect(laptop.machine.label).toBe('Laptop')
    expect(laptop.machine.connectionChangedAt).toEqual(
      DateTime.makeUnsafe(Duration.toMillis(DETACH_AFTER)),
    )
    expect(laptop.machine.agentVersion).toEqual(Option.some('0.1.0'))
    expect(laptop.machine.herdrVersion).toEqual(Option.some('0.9.1'))
  }).pipe(withFreshHerd),
)

it.effect('shows a dropped machine reconnecting, then offline once the grace runs out', () =>
  Effect.gen(function* () {
    const attachment = yield* attach(LAPTOP)

    yield* TestClock.adjust(DETACH_AFTER)
    yield* Fiber.interrupt(attachment)
    const dropped = yield* Effect.fromOption(machineIn(yield* currentView, LAPTOP))

    expect(dropped.machine.connection).toBe('reconnecting')
    expect(dropped.machine.connectionChangedAt).toEqual(
      DateTime.makeUnsafe(Duration.toMillis(DETACH_AFTER)),
    )

    yield* TestClock.adjust(Duration.subtract(RECONNECT_GRACE, BEFORE_GRACE_ENDS))

    expect(connectionOf(yield* currentView, LAPTOP)).toEqual(Option.some('reconnecting'))

    yield* TestClock.adjust(BEFORE_GRACE_ENDS)
    const offline = yield* Effect.fromOption(machineIn(yield* currentView, LAPTOP))

    expect(offline.machine.connection).toBe('offline')
    expect(offline.machine.lastSeenAt).toEqual(DateTime.makeUnsafe(Duration.toMillis(DETACH_AFTER)))
  }).pipe(withFreshHerd),
)

it.effect('stays online through a reconnect inside the grace, from the new connection on', () =>
  Effect.gen(function* () {
    yield* Fiber.interrupt(yield* attach(LAPTOP))
    yield* TestClock.adjust(BEFORE_GRACE_ENDS)
    yield* attach(LAPTOP)
    yield* TestClock.adjust(RECONNECT_GRACE)
    const laptop = yield* Effect.fromOption(machineIn(yield* currentView, LAPTOP))

    expect(laptop.machine.connection).toBe('online')
    expect(laptop.machine.connectionChangedAt).toEqual(
      DateTime.makeUnsafe(Duration.toMillis(BEFORE_GRACE_ENDS)),
    )
  }).pipe(withFreshHerd),
)

it.effect('keeps a machine online until its last overlapping Attach ends', () =>
  Effect.gen(function* () {
    const stale = yield* attach(LAPTOP)
    const fresh = yield* attach(LAPTOP)

    yield* Fiber.interrupt(stale)

    expect(connectionOf(yield* currentView, LAPTOP)).toEqual(Option.some('online'))

    yield* Fiber.interrupt(fresh)

    expect(connectionOf(yield* currentView, LAPTOP)).toEqual(Option.some('reconnecting'))
  }).pipe(withFreshHerd),
)

it.effect('keeps the last published state after the machine goes offline', () =>
  Effect.gen(function* () {
    const herd = yield* Herd
    const attachment = yield* attach(LAPTOP)

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1))
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2))
    yield* Fiber.interrupt(attachment)
    yield* TestClock.adjust(RECONNECT_GRACE)
    const laptop = yield* Effect.fromOption(machineIn(yield* currentView, LAPTOP))

    expect(laptop.machine.connection).toBe('offline')
    expect(laptop.state).toEqual(Option.some(stateOf(LAPTOP, 2)))
  }).pipe(withFreshHerd),
)

it.effect('lists machines in id order', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* herd.publish(WORK, stateOf(WORK, 0))
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 0))
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

it.effect('lists machines from the registry offline, with last seen, after a hub restart', () =>
  Effect.gen(function* () {
    const hub = yield* restartingHerd()

    yield* hub.run(
      Effect.gen(function* () {
        const herd = yield* Herd
        const attachment = yield* attach(LAPTOP)

        yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1))
        yield* TestClock.adjust(DETACH_AFTER)
        yield* Fiber.interrupt(attachment)
      }),
    )
    const laptop = yield* hub.run(
      Effect.flatMap(currentView, (view) => Effect.fromOption(machineIn(view, LAPTOP))),
    )

    expect(laptop.machine.connection).toBe('offline')
    expect(laptop.machine.lastSeenAt).toEqual(DateTime.makeUnsafe(Duration.toMillis(DETACH_AFTER)))
    expect(laptop.machine.agentVersion).toEqual(Option.some('0.0.9'))
    expect(laptop.machine.herdrVersion).toEqual(Option.some('0.9.1'))
    expect(laptop.state).toEqual(Option.none())
  }),
)

it.effect('forgets an offline machine until its agent connects again, across restarts', () =>
  Effect.gen(function* () {
    const hub = yield* restartingHerd()

    yield* hub.run(
      Effect.gen(function* () {
        const herd = yield* Herd

        yield* Fiber.interrupt(yield* attach(LAPTOP))
        yield* TestClock.adjust(RECONNECT_GRACE)
        yield* herd.forget(LAPTOP)

        expect(machineIn(yield* currentView, LAPTOP)).toEqual(Option.none())
      }),
    )
    const afterRestart = yield* hub.run(currentView)
    const afterReconnect = yield* hub.run(Effect.andThen(attach(LAPTOP), currentView))

    expect(machineIn(afterRestart, LAPTOP)).toEqual(Option.none())
    expect(connectionOf(afterReconnect, LAPTOP)).toEqual(Option.some('online'))
  }),
)

it.effect('refuses to forget a machine that is online, reconnecting or unknown', () =>
  Effect.gen(function* () {
    const herd = yield* Herd
    const attachment = yield* attach(LAPTOP)
    const whileOnline = yield* herd.forget(LAPTOP).pipe(Effect.flip)

    yield* Fiber.interrupt(attachment)
    const whileReconnecting = yield* herd.forget(LAPTOP).pipe(Effect.flip)
    const unknown = yield* herd.forget(WORK).pipe(Effect.flip)

    expect(whileOnline).toEqual(
      new MachineStillConnected({ machine: LAPTOP, connection: 'online' }),
    )
    expect(whileReconnecting).toEqual(
      new MachineStillConnected({ machine: LAPTOP, connection: 'reconnecting' }),
    )
    expect(unknown).toEqual(new MachineNotInHerd({ machine: WORK }))
    expect(connectionOf(yield* currentView, LAPTOP)).toEqual(Option.some('reconnecting'))
  }).pipe(withFreshHerd),
)

it.effect('marks a pane seen at its current state_change_seq, until the next change', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 7), agentAt(OTHER_PANE, 3)]))
    yield* herd.markSeen(LAPTOP, PANE)
    const seen = seenOf(yield* currentView, LAPTOP)

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2, [agentAt(PANE, 8), agentAt(OTHER_PANE, 3)]))
    const changed = seenOf(yield* currentView, LAPTOP)

    expect(seen).toEqual(Option.some([PANE]))
    expect(changed).toEqual(Option.some([]))
  }).pipe(withFreshHerd),
)

it.effect('treats a state_change_seq that went backwards as unseen', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 7)]))
    yield* herd.markSeen(LAPTOP, PANE)
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2, [agentAt(PANE, 2)]))

    expect(seenOf(yield* currentView, LAPTOP)).toEqual(Option.some([]))
  }).pipe(withFreshHerd),
)

it.effect('keeps a restarted state_change_seq unseen as it climbs back past the old mark', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 7)]))
    yield* herd.markSeen(LAPTOP, PANE)
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2, [agentAt(PANE, 2)]))
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 3, [agentAt(PANE, 7)]))

    expect(seenOf(yield* currentView, LAPTOP)).toEqual(Option.some([]))
  }).pipe(withFreshHerd),
)

it.effect('drops a mark once herdr restarts the pane, even if its sequence lands on the mark', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 1, BEFORE_HANDOFF)]))
    yield* herd.markSeen(LAPTOP, PANE)
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2, [agentAt(PANE, 1, AFTER_HANDOFF)], 2))

    expect(seenOf(yield* currentView, LAPTOP)).toEqual(Option.some([]))
  }).pipe(withFreshHerd),
)

it.effect('keeps a mark through a resync that reconnected to the same herdr server', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 7)]))
    yield* herd.markSeen(LAPTOP, PANE)
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2, [agentAt(PANE, 7)], 2))

    expect(seenOf(yield* currentView, LAPTOP)).toEqual(Option.some([PANE]))
  }).pipe(withFreshHerd),
)

it.effect('keeps a mark through a handoff while the agent carries the state it marked', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 5)]))
    yield* herd.markSeen(LAPTOP, PANE)
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2, [handedOffAt(1, 'unknown')], 2))
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 3, [handedOffAt(2, 'done')], 2))
    const redetected = seenOf(yield* currentView, LAPTOP)

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 4, [agentAt(PANE, 3, AFTER_HANDOFF)], 2))

    expect(redetected).toEqual(Option.some([PANE]))
    expect(seenOf(yield* currentView, LAPTOP)).toEqual(Option.some([]))
  }).pipe(withFreshHerd),
)

it.effect(
  'marks a handed-off agent at the state it carries, so the mark outlives re-detection',
  () =>
    Effect.gen(function* () {
      const herd = yield* Herd

      yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [handedOffAt(1, 'unknown')]))
      yield* herd.markSeen(LAPTOP, PANE)
      yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2, [handedOffAt(2, 'done')]))

      expect(seenOf(yield* currentView, LAPTOP)).toEqual(Option.some([PANE]))
    }).pipe(withFreshHerd),
)

it.effect(
  'drops a mark the hub kept while herdr restarted unheard and the sequence came back',
  () =>
    Effect.gen(function* () {
      const hub = yield* restartingHerd()

      yield* hub.run(
        Effect.gen(function* () {
          const herd = yield* Herd

          yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 1, BEFORE_HANDOFF)]))
          yield* herd.markSeen(LAPTOP, PANE)
        }),
      )
      const afterRestart = yield* hub.run(
        Effect.gen(function* () {
          const herd = yield* Herd

          yield* herd.publish(LAPTOP, stateOf(LAPTOP, 0, [agentAt(PANE, 1, AFTER_HANDOFF)], 2))

          return yield* currentView
        }),
      )
      const tracker = yield* Layer.build(
        Layer.provide(SeenTracker.layer, Layer.succeedContext(hub.database)),
      )
      const stored = yield* Effect.flatMap(SeenTracker, (seenTracker) => seenTracker.all).pipe(
        Effect.provide(tracker),
      )

      expect(seenOf(afterRestart, LAPTOP)).toEqual(Option.some([]))
      expect(stored).toEqual([])
    }),
)

it.effect('refuses to mark seen a pane or a machine the herd does not show', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 7)]))
    const unknownPane = yield* herd.markSeen(LAPTOP, OTHER_PANE).pipe(Effect.flip)
    const unknownMachine = yield* herd.markSeen(WORK, PANE).pipe(Effect.flip)

    expect(unknownPane).toEqual(new PaneNotInHerd({ machine: LAPTOP, pane: OTHER_PANE }))
    expect(unknownMachine).toEqual(new MachineNotInHerd({ machine: WORK }))
  }).pipe(withFreshHerd),
)

it.effect('keeps seen across a hub restart and drops it once the pane is gone', () =>
  Effect.gen(function* () {
    const hub = yield* restartingHerd()
    const twoPanes = stateOf(LAPTOP, 1, [agentAt(PANE, 7), agentAt(OTHER_PANE, 3)])

    yield* hub.run(
      Effect.gen(function* () {
        const herd = yield* Herd

        yield* attach(LAPTOP)
        yield* herd.publish(LAPTOP, twoPanes)
        yield* herd.markSeen(LAPTOP, PANE)
        yield* herd.markSeen(LAPTOP, OTHER_PANE)
      }),
    )
    const afterRestart = yield* hub.run(
      Effect.gen(function* () {
        const herd = yield* Herd

        yield* attach(LAPTOP)
        yield* herd.publish(LAPTOP, twoPanes)
        const view = yield* currentView

        yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2, [agentAt(PANE, 7)]))

        return view
      }),
    )
    const tracker = yield* Layer.build(
      Layer.provide(SeenTracker.layer, Layer.succeedContext(hub.database)),
    )
    const stored = yield* Effect.flatMap(SeenTracker, (seenTracker) => seenTracker.all).pipe(
      Effect.provide(tracker),
    )

    expect(seenOf(afterRestart, LAPTOP)).toEqual(Option.some([PANE, OTHER_PANE]))
    expect(stored.map((record) => record.pane)).toEqual([PANE])
  }),
)

it.effect('shows an agent version it cannot read as none, with the machine online anyway', () =>
  Effect.gen(function* () {
    yield* attach(LAPTOP, new Hello({ agentVersion: '0.2.0-rc.1', label: Option.none() }))
    const laptop = yield* Effect.fromOption(machineIn(yield* currentView, LAPTOP))

    expect(laptop.machine.connection).toBe('online')
    expect(laptop.machine.agentVersion).toEqual(Option.none())
  }).pipe(withFreshHerd),
)

it.effect('follows the agent link from memory when the database refuses its writes', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* attach(LAPTOP)
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 7)]))
    const laptop = yield* Effect.fromOption(machineIn(yield* currentView, LAPTOP))

    expect(laptop.machine.connection).toBe('online')
    expect(laptop.state).toEqual(Option.some(stateOf(LAPTOP, 1, [agentAt(PANE, 7)])))
  }).pipe(withRefusingStorage),
)

it.effect('deletes dropped seen marks even when storing the machine fails', () =>
  Effect.gen(function* () {
    const herd = yield* Herd
    const seenTracker = yield* SeenTracker

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 7)]))
    yield* herd.markSeen(LAPTOP, PANE)
    const marked = yield* seenTracker.all

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2, [agentAt(PANE, 8)]))
    const stored = yield* seenTracker.all

    expect(marked.map((record) => record.pane)).toEqual([PANE])
    expect(stored).toEqual([])
  }).pipe(withRefusingRegistry),
)

it.effect('refuses forget and mark seen with nothing changed when the database refuses', () =>
  Effect.gen(function* () {
    const herd = yield* Herd
    const attachment = yield* attach(LAPTOP)

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 7)]))
    const notSeen = yield* herd.markSeen(LAPTOP, PANE).pipe(Effect.flip)
    const seen = seenOf(yield* currentView, LAPTOP)

    yield* Fiber.interrupt(attachment)
    yield* TestClock.adjust(RECONNECT_GRACE)
    const notForgotten = yield* herd.forget(LAPTOP).pipe(Effect.flip)
    const connection = connectionOf(yield* currentView, LAPTOP)

    expect(notSeen).toBe(storageRefused)
    expect(seen).toEqual(Option.some([]))
    expect(notForgotten).toBe(storageRefused)
    expect(connection).toEqual(Option.some('offline'))
  }).pipe(withRefusingStorage),
)

it.effect('pins and unpins an agent of a known machine, and refuses a pane it has never seen', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* attach(LAPTOP)
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 7), agentAt(OTHER_PANE, 3)]))
    yield* herd.setPinned(LAPTOP, OTHER_PANE, true)
    yield* herd.setPinned(LAPTOP, OTHER_PANE, true)
    const pinned = pinnedOf(yield* currentView, LAPTOP)

    yield* herd.setPinned(LAPTOP, OTHER_PANE, false)
    const unpinned = pinnedOf(yield* currentView, LAPTOP)
    const unknownPane = yield* herd.setPinned(LAPTOP, PaneId.make('w1:p9'), true).pipe(Effect.flip)
    const unknownMachine = yield* herd.setPinned(WORK, PANE, true).pipe(Effect.flip)

    expect(pinned).toEqual(Option.some([OTHER_PANE]))
    expect(unpinned).toEqual(Option.some([]))
    expect(unknownPane).toEqual(new PaneNotInHerd({ machine: LAPTOP, pane: PaneId.make('w1:p9') }))
    expect(unknownMachine).toEqual(new MachineNotInHerd({ machine: WORK }))
  }).pipe(withFreshHerd),
)

it.effect('keeps a pin while its pane is away, and shows it again when the pane returns', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* attach(LAPTOP)
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 7)]))
    yield* herd.setPinned(LAPTOP, PANE, true)
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 2, []))
    const away = pinnedOf(yield* currentView, LAPTOP)

    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 3, [agentAt(PANE, 1)]))
    const back = pinnedOf(yield* currentView, LAPTOP)

    expect(away).toEqual(Option.some([]))
    expect(back).toEqual(Option.some([PANE]))
  }).pipe(withFreshHerd),
)

it.effect('keeps pins across a hub restart', () =>
  Effect.gen(function* () {
    const hub = yield* restartingHerd()
    const state = stateOf(LAPTOP, 1, [agentAt(PANE, 7)])

    yield* hub.run(
      Effect.gen(function* () {
        const herd = yield* Herd

        yield* attach(LAPTOP)
        yield* herd.publish(LAPTOP, state)
        yield* herd.setPinned(LAPTOP, PANE, true)
      }),
    )
    const afterRestart = yield* hub.run(
      Effect.gen(function* () {
        const herd = yield* Herd

        yield* attach(LAPTOP)
        yield* herd.publish(LAPTOP, state)

        return yield* currentView
      }),
    )

    expect(pinnedOf(afterRestart, LAPTOP)).toEqual(Option.some([PANE]))
  }),
)

it.effect('refuses a pin with nothing changed when the database refuses', () =>
  Effect.gen(function* () {
    const herd = yield* Herd

    yield* attach(LAPTOP)
    yield* herd.publish(LAPTOP, stateOf(LAPTOP, 1, [agentAt(PANE, 7)]))
    const refused = yield* herd.setPinned(LAPTOP, PANE, true).pipe(Effect.flip)

    expect(refused).toBe(storageRefused)
    expect(pinnedOf(yield* currentView, LAPTOP)).toEqual(Option.some([]))
  }).pipe(withRefusingStorage),
)
