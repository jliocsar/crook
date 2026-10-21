import { describe, expect, it, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'
import * as RpcTest from 'effect/rpc/RpcTest'

import { ClientApi, MachineStillConnected, PaneNotInHerd } from '@crook/protocol/ClientApi'
import {
  agentSocketUrl,
  callsFrom,
  HubCallDefected,
  hubSocketUrl,
} from '@crook/web/rpc/HubConnection'

import { agent, DESK, herd, LAPTOP, machine } from '../HerdFixtures.ts'

const view = herd([machine(LAPTOP, [agent('w1:p1', 'done')])])

const missingPane = agent('w1:p9', 'idle').pane

const handlers = ClientApi.toLayer({
  WatchHerd: () => Stream.make(view),
  ForgetMachine: ({ machine: machineId }) =>
    machineId === LAPTOP
      ? Effect.fail(new MachineStillConnected({ machine: machineId, connection: 'online' }))
      : Effect.void,
  MarkSeen: ({ machine: machineId, pane }) =>
    pane === missingPane
      ? Effect.fail(new PaneNotInHerd({ machine: machineId, pane }))
      : Effect.void,
  SetPinned: () => Effect.die('SetPinned is not part of this test.'),
  SendCommand: () => Effect.die('SendCommand is not part of this test.'),
  WatchTranscript: () => Stream.die('WatchTranscript is not part of this test.'),
})

const dyingHandlers = ClientApi.toLayer({
  WatchHerd: () => Stream.die('a WatchHerd handler crashed'),
  ForgetMachine: () => Effect.void,
  MarkSeen: () => Effect.die('a MarkSeen handler crashed'),
  SetPinned: () => Effect.die('SetPinned is not part of this test.'),
  SendCommand: () => Effect.die('SendCommand is not part of this test.'),
  WatchTranscript: () => Stream.die('WatchTranscript is not part of this test.'),
})

describe('hubSocketUrl', () => {
  it('dials the client endpoint on the page origin, secure when the page is', () => {
    expect(hubSocketUrl(new URL('https://my-hub.exe.xyz/m/laptop')).href).toBe(
      'wss://my-hub.exe.xyz/rpc/client',
    )
    expect(hubSocketUrl(new URL('http://localhost:5192/')).href).toBe(
      'ws://localhost:5192/rpc/client',
    )
  })

  it('gives the agent endpoint on the same origin for a machine to dial', () => {
    expect(agentSocketUrl(new URL('https://my-hub.exe.xyz/machines')).href).toBe(
      'wss://my-hub.exe.xyz/rpc/agent',
    )
  })
})

layer(handlers)('callsFrom', (withHandlers) => {
  withHandlers.effect('watches the herd and passes MarkSeen refusals through', () =>
    Effect.gen(function* () {
      const calls = callsFrom(yield* RpcTest.makeClient(ClientApi))
      const views = yield* Stream.runCollect(calls.watchHerd)

      yield* calls.markSeen(LAPTOP, agent('w1:p1', 'done').pane)
      const refusal = yield* Effect.flip(calls.markSeen(LAPTOP, missingPane))

      expect(views).toEqual([view])
      expect(refusal).toBeInstanceOf(PaneNotInHerd)
    }),
  )

  withHandlers.effect('forgets a machine and passes the refusal for a connected one through', () =>
    Effect.gen(function* () {
      const calls = callsFrom(yield* RpcTest.makeClient(ClientApi))

      yield* calls.forgetMachine(DESK)
      const refusal = yield* Effect.flip(calls.forgetMachine(LAPTOP))

      expect(refusal).toBeInstanceOf(MachineStillConnected)
    }),
  )
})

layer(dyingHandlers)('callsFrom over a hub that dies', (withHandlers) => {
  withHandlers.effect('turns a call that died into a typed failure the link retries', () =>
    Effect.gen(function* () {
      const calls = callsFrom(yield* RpcTest.makeClient(ClientApi))
      const watchFailure = yield* Effect.flip(Stream.runDrain(calls.watchHerd))
      const markSeenFailure = yield* Effect.flip(calls.markSeen(LAPTOP, missingPane))

      expect(watchFailure).toBeInstanceOf(HubCallDefected)
      expect(markSeenFailure).toBeInstanceOf(HubCallDefected)
    }),
  )
})
