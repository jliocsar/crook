import { describe, expect, it, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Stream from 'effect/Stream'
import * as RpcTest from 'effect/rpc/RpcTest'

import { ClientApi, PaneNotInHerd } from '@crook/protocol/ClientApi'
import { callsFrom, HubCallDefected, hubSocketUrl } from '@crook/web/rpc/HubConnection'

import { agent, herd, LAPTOP, machine } from '../HerdFixtures.ts'

const view = herd([machine(LAPTOP, [agent('w1:p1', 'done')])])

const missingPane = agent('w1:p9', 'idle').pane

const handlers = ClientApi.toLayer({
  WatchHerd: () => Stream.make(view),
  ForgetMachine: () => Effect.void,
  MarkSeen: ({ machine: machineId, pane }) =>
    pane === missingPane
      ? Effect.fail(new PaneNotInHerd({ machine: machineId, pane }))
      : Effect.void,
  SendCommand: () => Effect.die('SendCommand is not part of this test.'),
})

const dyingHandlers = ClientApi.toLayer({
  WatchHerd: () => Stream.die('a WatchHerd handler crashed'),
  ForgetMachine: () => Effect.void,
  MarkSeen: () => Effect.die('a MarkSeen handler crashed'),
  SendCommand: () => Effect.die('SendCommand is not part of this test.'),
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
