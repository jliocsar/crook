import { describe, expect, it, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Stream from 'effect/Stream'
import * as RpcTest from 'effect/rpc/RpcTest'

import { AgentStarted, StartAgent } from '@crook/domain/Command'
import { IdempotencyKey } from '@crook/domain/Ids'
import { defaultNotificationPrefs, NotificationSettings } from '@crook/domain/Notifications'
import {
  ClientApi,
  HubAccount,
  HubStorageFailed,
  MachineStillConnected,
  PaneNotInHerd,
} from '@crook/protocol/ClientApi'
import { FolderNotFound } from '@crook/protocol/Commands'
import { HarkReachedNoDevice } from '@crook/protocol/Hark'
import {
  agentSocketUrl,
  callsFrom,
  HubCallDefected,
  hubSocketUrl,
} from '@crook/web/rpc/HubConnection'

import { agent, DESK, herd, LAPTOP, machine } from '../HerdFixtures.ts'

const MISSING_FOLDER = '/home/jliocsar/Projects/nowhere'

const view = herd([machine(LAPTOP, [agent('w1:p1', 'done')])])

const missingPane = agent('w1:p9', 'idle').pane

const startedPane = agent('w1:p8', 'idle').pane

const launchKey = IdempotencyKey.make('3f1c2a9e')

const settings = new NotificationSettings({ prefs: defaultNotificationPrefs, delivery: 'noToken' })

const account = new HubAccount({ email: 'owner@example.com' })

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
  SetPinned: ({ machine: machineId, pane }) =>
    pane === missingPane
      ? Effect.fail(new PaneNotInHerd({ machine: machineId, pane }))
      : Effect.void,
  SendCommand: ({ command }) =>
    Match.value(command).pipe(
      Match.tag('StartAgent', (start) =>
        start.folder === MISSING_FOLDER
          ? Effect.fail(new FolderNotFound({ folder: start.folder }))
          : Effect.succeed(new AgentStarted({ pane: startedPane })),
      ),
      Match.orElse(() => Effect.die('Only StartAgent is part of this test.')),
    ),
  WatchTranscript: () => Stream.die('WatchTranscript is not part of this test.'),
  WatchNotificationSettings: () => Stream.make(settings),
  SetNotificationPref: ({ event }) =>
    event === 'approvals'
      ? Effect.fail(new HubStorageFailed({ detail: 'disk full' }))
      : Effect.void,
  SendTestNotification: () => Effect.fail(new HarkReachedNoDevice()),
  GetAccount: () => Effect.succeed(account),
})

const dyingHandlers = ClientApi.toLayer({
  WatchHerd: () => Stream.die('a WatchHerd handler crashed'),
  ForgetMachine: () => Effect.void,
  MarkSeen: () => Effect.die('a MarkSeen handler crashed'),
  SetPinned: () => Effect.die('SetPinned is not part of this test.'),
  SendCommand: () => Effect.die('SendCommand is not part of this test.'),
  WatchTranscript: () => Stream.die('WatchTranscript is not part of this test.'),
  WatchNotificationSettings: () =>
    Stream.die('WatchNotificationSettings is not part of this test.'),
  SetNotificationPref: () => Effect.die('SetNotificationPref is not part of this test.'),
  SendTestNotification: () => Effect.die('SendTestNotification is not part of this test.'),
  GetAccount: () => Effect.die('a GetAccount handler crashed'),
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

  withHandlers.effect('sends a launch and passes its receipt and its refusals through', () =>
    Effect.gen(function* () {
      const calls = callsFrom(yield* RpcTest.makeClient(ClientApi))
      const launch = (folder: string) =>
        new StartAgent({ kind: 'claude', folder, task: Option.some('Fix the banner') })
      const receipt = yield* calls.sendCommand(
        LAPTOP,
        launchKey,
        launch('/home/jliocsar/Projects/crook'),
      )
      const refusal = yield* Effect.flip(
        calls.sendCommand(LAPTOP, launchKey, launch(MISSING_FOLDER)),
      )

      expect(receipt).toEqual(new AgentStarted({ pane: startedPane }))
      expect(refusal).toBeInstanceOf(FolderNotFound)
    }),
  )
})

layer(handlers)('callsFrom for pane actions', (withHandlers) => {
  const pane = agent('w1:p1', 'done').pane

  withHandlers.effect(
    'pins a pane and passes the refusal for one the hub does not know through',
    () =>
      Effect.gen(function* () {
        const calls = callsFrom(yield* RpcTest.makeClient(ClientApi))

        yield* calls.setPinned(LAPTOP, pane, true)
        const refusal = yield* Effect.flip(calls.setPinned(LAPTOP, missingPane, false))

        expect(refusal).toBeInstanceOf(PaneNotInHerd)
      }),
  )
})

layer(handlers)('callsFrom for the Settings screen', (withHandlers) => {
  withHandlers.effect('watches the switches, writes one and passes the refusals through', () =>
    Effect.gen(function* () {
      const calls = callsFrom(yield* RpcTest.makeClient(ClientApi))
      const watched = yield* Stream.runCollect(calls.watchNotificationSettings)

      yield* calls.setNotificationPref('finished', false)
      const prefRefusal = yield* Effect.flip(calls.setNotificationPref('approvals', false))
      const testRefusal = yield* Effect.flip(calls.sendTestNotification)

      expect(watched).toEqual([settings])
      expect(prefRefusal).toEqual(new HubStorageFailed({ detail: 'disk full' }))
      expect(testRefusal).toEqual(new HarkReachedNoDevice())
    }),
  )

  withHandlers.effect('reads the account the connection logged in as', () =>
    Effect.gen(function* () {
      const calls = callsFrom(yield* RpcTest.makeClient(ClientApi))

      expect(yield* calls.account).toEqual(account)
    }),
  )
})

layer(dyingHandlers)('callsFrom over a hub that dies', (withHandlers) => {
  withHandlers.effect('turns a call that died into a typed failure the link retries', () =>
    Effect.gen(function* () {
      const calls = callsFrom(yield* RpcTest.makeClient(ClientApi))
      const watchFailure = yield* Effect.flip(Stream.runDrain(calls.watchHerd))
      const markSeenFailure = yield* Effect.flip(calls.markSeen(LAPTOP, missingPane))
      const accountFailure = yield* Effect.flip(calls.account)
      const settingsFailure = yield* Effect.flip(Stream.runDrain(calls.watchNotificationSettings))

      expect(watchFailure).toBeInstanceOf(HubCallDefected)
      expect(markSeenFailure).toBeInstanceOf(HubCallDefected)
      expect(accountFailure).toBeInstanceOf(HubCallDefected)
      expect(settingsFailure).toBeInstanceOf(HubCallDefected)
    }),
  )
})
