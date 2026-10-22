import * as BunServices from '@effect/platform-bun/BunServices'
import { expect, it, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'

import { HubConnectionStatus } from '@crook/agent/HubConnection'
import { agentVersion } from '@crook/agent/HubLink'
import {
  AgentAlreadyRunning,
  LaunchdAgentState,
  ServiceAbsent,
  ServiceAlreadyLoaded,
  ServiceNotInstalled,
  ServiceStarted,
  SystemdUnitState,
  agentServiceStatus,
  restartReport,
  restartService,
  serviceState,
  startReport,
  startService,
  statusReport,
  unitStateOf,
} from '@crook/agent/ServiceControl'
import { Launchd, type ServiceTarget, Systemd } from '@crook/agent/ServiceInstaller'
import {
  ServiceManager,
  type ServiceManagerCall,
  ServiceManagerRefused,
  commandLine,
} from '@crook/agent/ServiceManager'
import * as StatusSocket from '@crook/agent/StatusSocket'

interface Run {
  readonly answer?: (call: ServiceManagerCall) => Effect.Effect<string, ServiceManagerRefused>
}

const MAC_USER = 501
const REFUSED_EXIT_CODE = 113
const UNIT_SHOWN = 'ActiveState=active\nSubState=running\nUnitFileState=enabled\n'

const refusing =
  (verb: string) =>
  (call: ServiceManagerCall): Effect.Effect<string, ServiceManagerRefused> =>
    call.args.includes(verb)
      ? Effect.fail(
          new ServiceManagerRefused({
            command: commandLine(call),
            exitCode: REFUSED_EXIT_CODE,
            detail: 'Could not find service "crook-agent" in domain for user gui: 501',
          }),
        )
      : Effect.succeed('')

const scratch = Effect.fn('scratch')(function* (run: Run = {}) {
  const fileSystem = yield* FileSystem.FileSystem
  const home = yield* fileSystem.makeTempDirectoryScoped()
  const calls = yield* Queue.unbounded<ServiceManagerCall>()
  const context = yield* Layer.build(
    Layer.mergeAll(
      ServiceManager.layerTest(calls, run.answer),
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          HOME: home,
          XDG_CONFIG_HOME: `${home}/config`,
          XDG_STATE_HOME: `${home}/state`,
        }),
      ),
    ),
  )

  return {
    home,
    socket: `${home}/state/crook/status.sock`,
    provide: Effect.provide(context),
    calls: Queue.clear(calls).pipe(Effect.map((sent) => sent.map(commandLine))),
  }
})

const installedAt = Effect.fn('installedAt')(function* (definitionFile: string) {
  const fileSystem = yield* FileSystem.FileSystem

  yield* fileSystem.makeDirectory(definitionFile.slice(0, definitionFile.lastIndexOf('/')), {
    recursive: true,
  })
  yield* fileSystem.writeFileString(definitionFile, '')
})

const unitFile = (home: string) => `${home}/config/systemd/user/crook-agent.service`

const plistFile = (home: string) => `${home}/Library/LaunchAgents/crook-agent.plist`

const runningAgentAt = Effect.fn('runningAgentAt')(function* (home: string) {
  yield* Layer.build(
    Layer.provide(StatusSocket.layer, [
      HubConnectionStatus.layer,
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ HOME: home, XDG_STATE_HOME: `${home}/state` }),
      ),
    ]),
  )
})

const signallingOn =
  (verb: string, started: Deferred.Deferred<void>) =>
  (call: ServiceManagerCall): Effect.Effect<string, ServiceManagerRefused> =>
    call.args.includes(verb)
      ? Deferred.succeed(started, undefined).pipe(Effect.as(''))
      : Effect.succeed('')

const agentStartingAfter = Effect.fn('agentStartingAfter')(function* (
  started: Deferred.Deferred<void>,
  home: string,
) {
  yield* Deferred.await(started).pipe(
    Effect.andThen(Effect.sleep(StatusSocket.SLOWEST_MEASURED_STARTUP)),
    Effect.andThen(runningAgentAt(home)),
    Effect.forkScoped,
  )
})

it('reads the unit state systemctl show prints, and calls a missing property unknown', () => {
  expect(unitStateOf(UNIT_SHOWN)).toEqual(
    new SystemdUnitState({ activeState: 'active', subState: 'running', unitFileState: 'enabled' }),
  )
  expect(unitStateOf('ActiveState=failed\nSubState=failed\n')).toEqual(
    new SystemdUnitState({ activeState: 'failed', subState: 'failed', unitFileState: 'unknown' }),
  )
})

layer(BunServices.layer, { excludeTestServices: true })('ServiceControl', (onDisk) => {
  onDisk.effect('reports a service that was never installed without asking systemd', () =>
    Effect.gen(function* () {
      const { home, provide, calls } = yield* scratch()
      const state = yield* serviceState(new Systemd()).pipe(provide)

      expect(state).toEqual(new ServiceAbsent({ definitionFile: unitFile(home) }))
      expect(yield* calls).toEqual([])
    }),
  )

  onDisk.effect("asks systemd for an installed unit's state", () =>
    Effect.gen(function* () {
      const { home, provide, calls } = yield* scratch({
        answer: () => Effect.succeed(UNIT_SHOWN),
      })

      yield* installedAt(unitFile(home))

      expect(yield* serviceState(new Systemd()).pipe(provide)).toEqual(unitStateOf(UNIT_SHOWN))
      expect(yield* calls).toEqual([
        'systemctl --user show crook-agent.service --property=ActiveState,SubState,UnitFileState',
      ])
    }),
  )

  onDisk.effect(
    'calls a launchd agent loaded when launchctl prints it, and not when it refuses',
    () =>
      Effect.gen(function* () {
        const loaded = yield* scratch()
        const unloaded = yield* scratch({ answer: refusing('print') })
        const target = new Launchd({ userId: MAC_USER })

        yield* installedAt(plistFile(loaded.home))
        yield* installedAt(plistFile(unloaded.home))

        expect(yield* serviceState(target).pipe(loaded.provide)).toEqual(
          new LaunchdAgentState({ loaded: true }),
        )
        expect(yield* serviceState(target).pipe(unloaded.provide)).toEqual(
          new LaunchdAgentState({ loaded: false }),
        )
        expect(yield* loaded.calls).toEqual(['launchctl print gui/501/crook-agent'])
      }),
  )

  onDisk.effect('shows the running agent, its version and its hub link', () =>
    Effect.gen(function* () {
      const { home, provide } = yield* scratch({ answer: () => Effect.succeed(UNIT_SHOWN) })

      yield* installedAt(unitFile(home))
      yield* runningAgentAt(home)

      const status = yield* agentServiceStatus(new Systemd()).pipe(provide)
      const report = statusReport(status)

      expect(Result.isSuccess(status.running)).toBe(true)
      expect(report).toContain(`crook-agent v${agentVersion}`)
      expect(report).toContain(
        'Service: crook-agent.service is active (running) and enabled. Logs: journalctl --user -u crook-agent.service',
      )
      expect(report).toContain(`Agent: v${agentVersion}, process ${process.pid}, running since`)
      expect(report).toContain('Hub: not connected yet, trying since')
    }),
  )

  onDisk.effect('says no agent answers when nothing listens on the status socket', () =>
    Effect.gen(function* () {
      const { socket, provide } = yield* scratch()
      const report = statusReport(yield* agentServiceStatus(new Systemd()).pipe(provide))

      expect(report).toContain('Service: not installed')
      expect(report).toContain(`Agent: not answering. No crook agent answered on ${socket}`)
      expect(report).not.toContain('Hub:')
    }),
  )

  onDisk.effect('starts nothing while an agent already answers, even an uninstalled one', () =>
    Effect.gen(function* () {
      const { home, provide, calls } = yield* scratch()

      yield* installedAt(unitFile(home))
      yield* runningAgentAt(home)

      const outcome = yield* startService(new Systemd()).pipe(provide)

      expect(outcome).toEqual(new AgentAlreadyRunning({ agentVersion, processId: process.pid }))
      expect(startReport(outcome)).toBe(
        `crook-agent v${agentVersion} is already running as process ${process.pid}, so nothing was started.`,
      )
      expect(yield* calls).toEqual([])
    }),
  )

  onDisk.effect('starts nothing when no service is installed', () =>
    Effect.gen(function* () {
      const { home, provide, calls } = yield* scratch()
      const outcome = yield* startService(new Systemd()).pipe(provide)

      expect(outcome).toEqual(new ServiceAbsent({ definitionFile: unitFile(home) }))
      expect(startReport(outcome)).toContain(
        'not installed as a service yet, so nothing was started',
      )
      expect(yield* calls).toEqual([])
    }),
  )

  onDisk.effect('starts the installed unit when no agent answers', () =>
    Effect.gen(function* () {
      const { home, provide, calls } = yield* scratch()

      yield* installedAt(unitFile(home))

      expect(yield* startService(new Systemd()).pipe(provide)).toEqual(new ServiceStarted())
      expect(yield* calls).toEqual(['systemctl --user start crook-agent.service'])
    }),
  )

  onDisk.effect('loads a launchd agent that is not loaded, and leaves a loaded one alone', () =>
    Effect.gen(function* () {
      const target = new Launchd({ userId: MAC_USER })
      const unloaded = yield* scratch({ answer: refusing('print') })
      const loaded = yield* scratch()

      yield* installedAt(plistFile(unloaded.home))
      yield* installedAt(plistFile(loaded.home))

      expect(yield* startService(target).pipe(unloaded.provide)).toEqual(new ServiceStarted())
      expect(yield* unloaded.calls).toEqual([
        'launchctl print gui/501/crook-agent',
        'launchctl enable gui/501/crook-agent',
        `launchctl bootstrap gui/501 ${plistFile(unloaded.home)}`,
      ])
      expect(yield* startService(target).pipe(loaded.provide)).toEqual(new ServiceAlreadyLoaded())
      expect(yield* loaded.calls).toEqual(['launchctl print gui/501/crook-agent'])
    }),
  )

  onDisk.effect('restarts an installed unit and waits for the new agent to answer', () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>()
      const installed = yield* scratch({ answer: signallingOn('restart', started) })
      const missing = yield* scratch()

      yield* installedAt(unitFile(installed.home))
      yield* agentStartingAfter(started, installed.home)

      const answer = yield* restartService(new Systemd()).pipe(installed.provide)
      const refused = yield* restartService(new Systemd()).pipe(missing.provide, Effect.flip)

      expect(yield* installed.calls).toEqual(['systemctl --user restart crook-agent.service'])
      expect(restartReport(answer)).toBe(
        `Restarted the crook-agent service. crook-agent v${agentVersion} answers as process ${process.pid}.`,
      )
      expect(refused).toEqual(new ServiceNotInstalled({ definitionFile: unitFile(missing.home) }))
      expect(yield* missing.calls).toEqual([])
    }),
  )

  onDisk.effect('says so when only the agent from before the restart answers', () =>
    Effect.gen(function* () {
      const { home, provide } = yield* scratch()

      yield* installedAt(unitFile(home))
      yield* runningAgentAt(home)

      const report = restartReport(yield* restartService(new Systemd()).pipe(provide))

      expect(report).toContain(
        'Restarted the crook-agent service, but no new agent answered within',
      )
      expect(report).toContain(`process ${process.pid}, the agent from before, still answers`)
    }),
  )

  onDisk.effect('restarts a launchd agent by booting it out and loading it again', () =>
    Effect.gen(function* () {
      const target: ServiceTarget = new Launchd({ userId: MAC_USER })
      const started = yield* Deferred.make<void>()
      const { home, provide, calls } = yield* scratch({
        answer: signallingOn('bootstrap', started),
      })

      yield* installedAt(plistFile(home))
      yield* agentStartingAfter(started, home)
      yield* restartService(target).pipe(provide)

      expect(yield* calls).toEqual([
        'launchctl bootout gui/501/crook-agent',
        'launchctl enable gui/501/crook-agent',
        `launchctl bootstrap gui/501 ${plistFile(home)}`,
      ])
    }),
  )
})
