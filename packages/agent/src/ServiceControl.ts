import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import type { HubConnection } from '@crook/agent/HubConnection'
import { agentVersion } from '@crook/agent/HubLink'
import { SYSTEMD_UNIT_NAME } from '@crook/agent/ServiceDefinition'
import {
  type Launchd,
  type ServiceTarget,
  launchdLoaded,
  runStartCalls,
  servicePaths,
  stopLaunchdAgent,
} from '@crook/agent/ServiceInstaller'
import { ServiceManager, systemctl } from '@crook/agent/ServiceManager'
import {
  AGENT_STARTUP_TIMEOUT,
  type AgentAnswerUnreadable,
  CrookStatusSocketPath,
  type NoAgentAnswered,
  type RunningAgent,
  askRunningAgent,
  awaitAgentOtherThan,
} from '@crook/agent/StatusSocket'

export type ServiceState = ServiceAbsent | SystemdUnitState | LaunchdAgentState

export type StartOutcome =
  | AgentAlreadyRunning
  | OtherAgentRunning
  | ServiceAbsent
  | ServiceAlreadyLoaded
  | ServiceStarted

export type AgentAnswer = Result.Result<RunningAgent, NoAgentAnswered | AgentAnswerUnreadable>

export interface AgentServiceStatus {
  readonly service: ServiceState
  readonly running: AgentAnswer
}

const UNIT_PROPERTIES = ['ActiveState', 'SubState', 'UnitFileState']
const UNKNOWN_PROPERTY = 'unknown'
const SHOWN_PROPERTY = /^(\w+)=(.*)$/u

const CONNECT_HINT =
  'Run "Connect to hub" from the crook plugin in Herdr, or crook-agent install-service, to install it.'

export class ServiceAbsent extends Schema.TaggedClass<ServiceAbsent>()('ServiceAbsent', {
  definitionFile: Schema.String,
}) {}

export class SystemdUnitState extends Schema.TaggedClass<SystemdUnitState>()('SystemdUnitState', {
  activeState: Schema.String,
  subState: Schema.String,
  unitFileState: Schema.String,
}) {}

export class LaunchdAgentState extends Schema.TaggedClass<LaunchdAgentState>()(
  'LaunchdAgentState',
  { loaded: Schema.Boolean },
) {}

export class AgentAlreadyRunning extends Schema.TaggedClass<AgentAlreadyRunning>()(
  'AgentAlreadyRunning',
  { agentVersion: Schema.String, processId: Schema.Int },
) {}

export class OtherAgentRunning extends Schema.TaggedClass<OtherAgentRunning>()(
  'OtherAgentRunning',
  { detail: Schema.String },
) {}

export class ServiceAlreadyLoaded extends Schema.TaggedClass<ServiceAlreadyLoaded>()(
  'ServiceAlreadyLoaded',
  {},
) {}

export class ServiceStarted extends Schema.TaggedClass<ServiceStarted>()('ServiceStarted', {}) {}

export class ServiceNotInstalled extends Schema.TaggedError<ServiceNotInstalled>()(
  'ServiceNotInstalled',
  { definitionFile: Schema.String },
) {
  override get message(): string {
    return `crook-agent is not installed as a service: ${this.definitionFile} does not exist. ${CONNECT_HINT}`
  }
}

export class ServiceFileUnreadable extends Schema.TaggedError<ServiceFileUnreadable>()(
  'ServiceFileUnreadable',
  { path: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Could not tell whether ${this.path} exists: ${this.detail}. Check the permissions of that folder and run the same crook-agent command again.`
  }
}

export const unitStateOf = (shown: string): SystemdUnitState => {
  const properties = pipe(
    shown.split('\n'),
    Arr.flatMap((line) => Option.toArray(Option.fromNullishOr(SHOWN_PROPERTY.exec(line.trim())))),
    Arr.map((match): [string, string] => [match[1] ?? '', match[2] ?? '']),
    Record.fromEntries,
  )
  const property = (name: string) =>
    pipe(
      Record.get(properties, name),
      Option.filter((value) => value.length > 0),
      Option.getOrElse(() => UNKNOWN_PROPERTY),
    )

  return new SystemdUnitState({
    activeState: property('ActiveState'),
    subState: property('SubState'),
    unitFileState: property('UnitFileState'),
  })
}

const installedDefinition = Effect.fn('ServiceControl.installedDefinition')(function* (
  target: ServiceTarget,
) {
  const fileSystem = yield* FileSystem.FileSystem
  const { definitionFile } = yield* servicePaths(target)
  const installed = yield* fileSystem
    .exists(definitionFile)
    .pipe(
      Effect.mapError(
        (error) => new ServiceFileUnreadable({ path: definitionFile, detail: error.message }),
      ),
    )

  return installed
    ? Result.succeed(definitionFile)
    : Result.fail(new ServiceAbsent({ definitionFile }))
})

const whenInstalled = <Success, Failure, Requirements>(
  target: ServiceTarget,
  onInstalled: (definitionFile: string) => Effect.Effect<Success, Failure, Requirements>,
) =>
  Effect.flatMap(
    installedDefinition(target),
    (installed): Effect.Effect<Result.Result<Success, ServiceAbsent>, Failure, Requirements> =>
      Result.match(installed, {
        onFailure: (absent) => Effect.succeed(Result.fail(absent)),
        onSuccess: (definitionFile) => Effect.map(onInstalled(definitionFile), Result.succeed),
      }),
  )

const systemdUnitState = Effect.fn('ServiceControl.systemdUnitState')(function* () {
  const manager = yield* ServiceManager
  const shown = yield* manager.run(
    systemctl('show', SYSTEMD_UNIT_NAME, `--property=${UNIT_PROPERTIES.join(',')}`),
  )

  return unitStateOf(shown)
})

const launchdAgentState = Effect.fn('ServiceControl.launchdAgentState')(function* (
  launchd: Launchd,
) {
  return new LaunchdAgentState({ loaded: yield* launchdLoaded(launchd) })
})

export const serviceState = Effect.fn('ServiceControl.serviceState')(function* (
  target: ServiceTarget,
) {
  const state = yield* whenInstalled(target, () =>
    Match.value(target).pipe(
      Match.tagsExhaustive({ Systemd: () => systemdUnitState(), Launchd: launchdAgentState }),
    ),
  )

  return Result.merge(state)
})

export const agentServiceStatus = Effect.fn('ServiceControl.agentServiceStatus')(function* (
  target: ServiceTarget,
) {
  const socket = yield* CrookStatusSocketPath
  const service = yield* serviceState(target)
  const running = yield* Effect.result(askRunningAgent(socket))
  const status: AgentServiceStatus = { service, running }

  return status
})

const startSystemdUnit = Effect.fn('ServiceControl.startSystemdUnit')(function* () {
  const manager = yield* ServiceManager

  yield* manager.run(systemctl('start', SYSTEMD_UNIT_NAME))

  return new ServiceStarted()
})

const startLaunchdAgent = Effect.fn('ServiceControl.startLaunchdAgent')(function* (
  launchd: Launchd,
  definitionFile: string,
) {
  const loaded = yield* launchdLoaded(launchd)

  if (loaded) {
    return new ServiceAlreadyLoaded()
  }

  yield* runStartCalls(launchd, definitionFile)

  return new ServiceStarted()
})

const startInstalledService = Effect.fn('ServiceControl.startInstalledService')(function* (
  target: ServiceTarget,
) {
  const outcome = yield* whenInstalled(target, (definitionFile) =>
    Match.value(target).pipe(
      Match.tagsExhaustive({
        Systemd: () => startSystemdUnit(),
        Launchd: (launchd) => startLaunchdAgent(launchd, definitionFile),
      }),
    ),
  )

  return Result.merge(outcome)
})

export const startService = Effect.fn('ServiceControl.startService')(function* (
  target: ServiceTarget,
) {
  const socket = yield* CrookStatusSocketPath

  return yield* askRunningAgent(socket).pipe(
    Effect.map(
      (running): StartOutcome =>
        new AgentAlreadyRunning({
          agentVersion: running.agentVersion,
          processId: running.processId,
        }),
    ),
    Effect.catchTags({
      AgentAnswerUnreadable: (unreadable) =>
        Effect.succeed(new OtherAgentRunning({ detail: unreadable.message })),
      NoAgentAnswered: () => startInstalledService(target),
    }),
  )
})

const restartSystemdUnit = Effect.fn('ServiceControl.restartSystemdUnit')(function* () {
  const manager = yield* ServiceManager

  yield* manager.run(systemctl('restart', SYSTEMD_UNIT_NAME))
})

const restartLaunchdAgent = Effect.fn('ServiceControl.restartLaunchdAgent')(function* (
  launchd: Launchd,
  definitionFile: string,
) {
  yield* stopLaunchdAgent(launchd)
  yield* runStartCalls(launchd, definitionFile)
})

const restartInstalledService = Effect.fn('ServiceControl.restartInstalledService')(function* (
  socket: string,
  target: ServiceTarget,
  definitionFile: string,
) {
  const previous = yield* Effect.option(askRunningAgent(socket))

  yield* Match.value(target).pipe(
    Match.tagsExhaustive({
      Systemd: () => restartSystemdUnit(),
      Launchd: (launchd) => restartLaunchdAgent(launchd, definitionFile),
    }),
  )

  const answer: AgentAnswer = yield* Effect.result(awaitAgentOtherThan(socket, previous))

  return answer
})

export const restartService = Effect.fn('ServiceControl.restartService')(function* (
  target: ServiceTarget,
) {
  const socket = yield* CrookStatusSocketPath
  const restarted = yield* whenInstalled(target, (definitionFile) =>
    restartInstalledService(socket, target, definitionFile),
  )

  return yield* Effect.fromResult(
    Result.mapError(
      restarted,
      (absent) => new ServiceNotInstalled({ definitionFile: absent.definitionFile }),
    ),
  )
})

const serviceLine = (service: ServiceState) =>
  Match.value(service).pipe(
    Match.tagsExhaustive({
      ServiceAbsent: (absent) =>
        `not installed, there is no ${absent.definitionFile}. ${CONNECT_HINT}`,
      SystemdUnitState: (unit) =>
        `${SYSTEMD_UNIT_NAME} is ${unit.activeState} (${unit.subState}) and ${unit.unitFileState}. Logs: journalctl --user -u ${SYSTEMD_UNIT_NAME}`,
      LaunchdAgentState: (launchd) =>
        launchd.loaded
          ? 'loaded in launchd.'
          : 'installed but not loaded in launchd. Restart it to load it.',
    }),
  )

const hubLine = (hub: HubConnection) =>
  Match.value(hub).pipe(
    Match.tagsExhaustive({
      HubOnline: (online) => `connected since ${DateTime.formatIso(online.since)}.`,
      HubOffline: (offline) =>
        Option.match(offline.lastFailure, {
          onNone: () => `not connected yet, trying since ${DateTime.formatIso(offline.since)}.`,
          onSome: (failure) =>
            `not connected since ${DateTime.formatIso(offline.since)}. The last attempt ended with: ${failure}`,
        }),
    }),
  )

const runningLines = (running: AgentAnswer) =>
  Result.match(running, {
    onFailure: (failure) => [`Agent: not answering. ${failure.message}`],
    onSuccess: (agent) => [
      `Agent: v${agent.agentVersion}, process ${agent.processId}, running since ${DateTime.formatIso(agent.startedAt)}.`,
      `Hub: ${hubLine(agent.hub)}`,
      ...(agent.agentVersion === agentVersion
        ? []
        : [
            `The running agent is v${agent.agentVersion} and this program is v${agentVersion}; restart it to run v${agentVersion}.`,
          ]),
    ],
  })

export const statusReport = (status: AgentServiceStatus) =>
  [
    `crook-agent v${agentVersion}`,
    `Service: ${serviceLine(status.service)}`,
    ...runningLines(status.running),
  ].join('\n')

export const startReport = (outcome: StartOutcome) =>
  Match.value(outcome).pipe(
    Match.tagsExhaustive({
      AgentAlreadyRunning: (running) =>
        `crook-agent v${running.agentVersion} is already running as process ${running.processId}, so nothing was started.`,
      OtherAgentRunning: (other) =>
        `A crook agent is already running, so nothing was started. ${other.detail}`,
      ServiceAbsent: () =>
        `crook-agent is not installed as a service yet, so nothing was started. ${CONNECT_HINT}`,
      ServiceAlreadyLoaded: () =>
        'crook-agent is already loaded in launchd, so nothing was started.',
      ServiceStarted: () => 'Started the crook-agent service.',
    }),
  )

export const restartReport = (answer: AgentAnswer) =>
  Result.match(answer, {
    onSuccess: (agent) =>
      `Restarted the crook-agent service. crook-agent v${agent.agentVersion} answers as process ${agent.processId}.`,
    onFailure: (failure) =>
      Match.value(failure).pipe(
        Match.tagsExhaustive({
          NoAgentAnswered: (silent) =>
            `Restarted the crook-agent service, but no new agent answered within ${Duration.format(AGENT_STARTUP_TIMEOUT)}. ${silent.message} Its logs say why.`,
          AgentAnswerUnreadable: (unreadable) =>
            `Restarted the crook-agent service. ${unreadable.message}`,
        }),
      ),
  })
