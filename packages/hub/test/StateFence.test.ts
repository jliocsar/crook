import { expect, layer } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'

import type { AgentStatus } from '@crook/domain/AgentStatus'
import { findMachine } from '@crook/domain/HerdView'
import { MachineId } from '@crook/domain/Ids'
import { AgentLink } from '@crook/protocol/AgentLink'
import { ClientApi } from '@crook/protocol/ClientApi'
import { AGENT_PATH, CLIENT_PATH } from '@crook/protocol/HubRoutes'

import {
  PANE,
  agentRow,
  agentToken,
  connect,
  herdWhere,
  machineShows,
  machineStateWith,
  ownerLogin,
  testHub,
} from './Fixtures'
import { agentThroughProxy, attach, heldProxy, hubPort, replyFrom } from './HeldProxy'

const WORKING_VERSION = 1
const BLOCKED_VERSION = 2
const IDLE_VERSION = 3
const NEXT_VERSION = 4

const stateAt = (machine: MachineId, version: number, status: AgentStatus, seq: number) =>
  machineStateWith(machine, version, [
    agentRow({
      status,
      stateChangeSeq: seq,
      statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
    }),
  ])

const shownOn = (machine: MachineId) =>
  herdWhere(() => true).pipe(
    Effect.map((view) => findMachine(view, machine)),
    Effect.flatMap(Effect.fromOption),
  )

const versionShownOn = (machine: MachineId) =>
  Effect.map(shownOn(machine), (entry) => Option.map(entry.state, (state) => state.version))

const showsVersion = (machine: MachineId, version: number) =>
  herdWhere((view) =>
    Option.exists(findMachine(view, machine), (entry) =>
      Option.exists(entry.state, (state) => state.version === version),
    ),
  )

const blockedStateHeldBy = Effect.fn('blockedStateHeldBy')(function* (machine: MachineId) {
  const proxy = yield* heldProxy(yield* hubPort)
  const socketScope = yield* Scope.fork(yield* Effect.scope)
  const dying = yield* agentThroughProxy(proxy.port, machine).pipe(Scope.provide(socketScope))

  yield* attach(dying).pipe(Scope.provide(socketScope))
  yield* dying.PublishState({ state: stateAt(machine, WORKING_VERSION, 'working', 6) })
  yield* machineShows(machine, 'online')
  yield* proxy.hold

  const died = yield* dying
    .PublishState({ state: stateAt(machine, BLOCKED_VERSION, 'blocked', 7) })
    .pipe(Effect.exit)

  expect(Exit.isFailure(died)).toBe(true)

  yield* Scope.close(socketScope, Exit.void)

  const successor = yield* connect(AgentLink, AGENT_PATH, agentToken(machine))

  yield* attach(successor)

  return { proxy, successor }
})

layer(testHub, { excludeTestServices: true })('A state from a dead socket', (live) => {
  live.effect(
    'lands after its successor published, replies as ever and leaves the phone on the newer state',
    () =>
      Effect.gen(function* () {
        const machine = MachineId.make('state-fence-laptop')
        const { proxy, successor } = yield* blockedStateHeldBy(machine)
        const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)

        yield* successor.PublishState({ state: stateAt(machine, IDLE_VERSION, 'idle', 8) })
        yield* showsVersion(machine, IDLE_VERSION)
        yield* phone.MarkSeen({ machine, pane: PANE })
        yield* Queue.clear(proxy.replies)
        yield* proxy.releaseFirstHeld

        const reply = yield* replyFrom(proxy.replies, '"Exit"')
        const afterTheLateState = yield* shownOn(machine)

        yield* successor.PublishState({ state: stateAt(machine, NEXT_VERSION, 'working', 9) })
        const next = yield* versionShownOn(machine)

        expect(Option.exists(reply, (text) => text.includes('"Success"'))).toBe(true)
        expect(Option.map(afterTheLateState.state, (state) => state.version)).toEqual(
          Option.some(IDLE_VERSION),
        )
        expect(afterTheLateState.seen).toEqual([PANE])
        expect(next).toEqual(Option.some(NEXT_VERSION))
      }),
  )

  live.effect('lands before its successor published, and the first state replaces it', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('state-fence-quiet-successor')
      const { proxy, successor } = yield* blockedStateHeldBy(machine)

      yield* Queue.clear(proxy.replies)
      yield* proxy.releaseFirstHeld
      yield* replyFrom(proxy.replies, '"Exit"')
      const beforeTheFirstState = yield* versionShownOn(machine)

      yield* successor.PublishState({ state: stateAt(machine, IDLE_VERSION, 'idle', 8) })
      const afterTheFirstState = yield* versionShownOn(machine)

      expect(beforeTheFirstState).toEqual(Option.some(BLOCKED_VERSION))
      expect(afterTheFirstState).toEqual(Option.some(IDLE_VERSION))
    }),
  )
})
