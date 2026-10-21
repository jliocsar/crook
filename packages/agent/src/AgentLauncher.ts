import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Schedule from 'effect/Schedule'

import { CreatedPanes } from '@crook/agent/CreatedPanes'
import {
  type AgentKind,
  AgentStarted,
  type CreateWorktree,
  type LaunchCommand,
  type StartAgent,
} from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import {
  HerdrClient,
  type HerdrConnectionClosed,
  type HerdrRequestError,
  type HerdrResponseInvalid,
  type HerdrUnreachable,
} from '@crook/herdr/HerdrClient'
import {
  AgentPromptMethod,
  AgentStartMethod,
  AgentWaitMethod,
  PaneCloseMethod,
  TabCreateMethod,
  WorkspaceCreateMethod,
  WorktreeCreateMethod,
} from '@crook/herdr/Methods'
import type { PaneInfo, SessionSnapshot } from '@crook/herdr/Records'
import { AGENT_READY_TIMEOUT } from '@crook/protocol/AgentLink'
import {
  AgentNotStarted,
  CommandDeliveryUnknown,
  FolderNotFound,
  HerdrRefusedCommand,
  HerdrUnavailable,
  TaskNotDelivered,
} from '@crook/protocol/Commands'

interface LaunchedPane {
  readonly pane: PaneId
  readonly herdrRootPane: Option.Option<PaneId>
}

interface Refusal {
  readonly code: string
  readonly detail: string
}

type HerdrTransportError = HerdrUnreachable | HerdrConnectionClosed | HerdrResponseInvalid

type HerdrRefusalError = Exclude<HerdrRequestError, HerdrTransportError>

const AGENT_NAME_PREFIX = 'crook-'
const FIRST_AGENT_NUMBER = 1
const SLOWEST_MEASURED_SHELL_SPAWN = Duration.millis(27)

export const PANE_BUSY_RETRY_LIMIT = Duration.times(SLOWEST_MEASURED_SHELL_SPAWN, 10)

export const CLAUDE_CHILD_VARIABLES = [
  'AI_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_EFFORT',
  'CLAUDE_PID',
] as const

export const SCRUBBED_ENVIRONMENT: Readonly<Record<string, string>> = Record.fromEntries(
  Arr.map(CLAUDE_CHILD_VARIABLES, (name) => [name, ''] as const),
)

export const mintAgentName = (liveNames: readonly string[]): string =>
  pipe(
    Arr.range(FIRST_AGENT_NUMBER, liveNames.length + FIRST_AGENT_NUMBER),
    Arr.map((number) => `${AGENT_NAME_PREFIX}${number}`),
    Arr.findFirst((candidate) => !Arr.contains(liveNames, candidate)),
    Option.getOrElse(() => `${AGENT_NAME_PREFIX}${liveNames.length + FIRST_AGENT_NUMBER}`),
  )

const workingDirectoryOfPane = (pane: PaneInfo): Option.Option<string> =>
  Option.orElse(pane.foreground_cwd, () => pane.cwd)

export const workspaceWithFolder = (snapshot: SessionSnapshot, folder: string) =>
  Arr.findFirst(
    snapshot.workspaces,
    (workspace) =>
      Option.exists(workspace.worktree, (worktree) => worktree.checkout_path === folder) ||
      Arr.some(
        snapshot.panes,
        (pane) =>
          pane.workspace_id === workspace.workspace_id &&
          Option.contains(workingDirectoryOfPane(pane), folder),
      ),
  )

const liveAgentNames = (snapshot: SessionSnapshot) =>
  pipe(
    snapshot.agents,
    Arr.map((agent) => agent.name),
    Arr.getSomes,
  )

const refusalOf = (error: HerdrRefusalError): Refusal =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      HerdrRequestRejected: (rejected) => ({ code: rejected.code, detail: rejected.detail }),
      HerdrPaneNotFound: (missing) => ({ code: 'pane_not_found', detail: missing.detail }),
      HerdrAgentNotFound: (missing) => ({ code: 'agent_not_found', detail: missing.detail }),
      HerdrPaneBusy: (busy) => ({ code: 'agent_pane_busy', detail: busy.detail }),
      HerdrRequestInvalid: (invalid) => ({ code: 'request_invalid', detail: invalid.issue }),
    }),
  )

const isPaneBusy = (error: HerdrRequestError) =>
  Match.value(error).pipe(
    Match.tag('HerdrPaneBusy', () => true),
    Match.orElse(() => false),
  )

const make = Effect.gen(function* () {
  const herdr = yield* HerdrClient
  const createdPanes = yield* CreatedPanes
  const fileSystem = yield* FileSystem.FileSystem

  const requireFolder = (folder: string) =>
    fileSystem.stat(folder).pipe(
      Effect.filterOrFail(
        (info) => info.type === 'Directory',
        () => new FolderNotFound({ folder }),
      ),
      Effect.catchTag('PlatformError', () => Effect.fail(new FolderNotFound({ folder }))),
    )

  const readSnapshot = herdr.snapshot.pipe(
    Effect.catchTags({
      HerdrUnreachable: () => Effect.fail(new HerdrUnavailable()),
      HerdrConnectionClosed: () => Effect.fail(new HerdrUnavailable()),
      HerdrResponseInvalid: (invalid) => Effect.die(invalid),
      HerdrRequestInvalid: (invalid) => Effect.die(invalid),
      HerdrRequestRejected: (rejected) =>
        Effect.fail(new HerdrRefusedCommand({ code: rejected.code, detail: rejected.detail })),
      HerdrPaneNotFound: (missing) => Effect.fail(new HerdrRefusedCommand(refusalOf(missing))),
      HerdrAgentNotFound: (missing) => Effect.fail(new HerdrRefusedCommand(refusalOf(missing))),
      HerdrPaneBusy: (busy) => Effect.fail(new HerdrRefusedCommand(refusalOf(busy))),
    }),
  )

  const creating = <Created>(request: Effect.Effect<Created, HerdrRequestError>) =>
    request.pipe(
      Effect.catchTags({
        HerdrUnreachable: () => Effect.fail(new HerdrUnavailable()),
        HerdrConnectionClosed: () => Effect.fail(new CommandDeliveryUnknown()),
        HerdrResponseInvalid: () => Effect.fail(new CommandDeliveryUnknown()),
        HerdrRequestInvalid: (invalid) => Effect.die(invalid),
        HerdrRequestRejected: (rejected) =>
          Effect.fail(new HerdrRefusedCommand(refusalOf(rejected))),
        HerdrPaneNotFound: (missing) => Effect.fail(new HerdrRefusedCommand(refusalOf(missing))),
        HerdrAgentNotFound: (missing) => Effect.fail(new HerdrRefusedCommand(refusalOf(missing))),
        HerdrPaneBusy: (busy) => Effect.fail(new HerdrRefusedCommand(refusalOf(busy))),
      }),
    )

  const afterCreation = <Success, Failure>(
    request: Effect.Effect<Success, HerdrRequestError>,
    refused: (refusal: Refusal) => Failure,
  ) =>
    request.pipe(
      Effect.catchTags({
        HerdrUnreachable: () => Effect.fail(new CommandDeliveryUnknown()),
        HerdrConnectionClosed: () => Effect.fail(new CommandDeliveryUnknown()),
        HerdrResponseInvalid: () => Effect.fail(new CommandDeliveryUnknown()),
        HerdrRequestInvalid: (invalid) => Effect.die(invalid),
        HerdrRequestRejected: (rejected) => Effect.fail(refused(refusalOf(rejected))),
        HerdrPaneNotFound: (missing) => Effect.fail(refused(refusalOf(missing))),
        HerdrAgentNotFound: (missing) => Effect.fail(refused(refusalOf(missing))),
        HerdrPaneBusy: (busy) => Effect.fail(refused(refusalOf(busy))),
      }),
    )

  const remember = (pane: PaneId) =>
    createdPanes
      .remember(pane)
      .pipe(Effect.catchTag('CreatedPanesUnwritable', (error) => Effect.logWarning(error.message)))

  const closeQuietly = Effect.fn('AgentLauncher.closeQuietly')(function* (pane: PaneId) {
    return yield* herdr.request(PaneCloseMethod, { pane_id: pane }).pipe(
      Effect.andThen(createdPanes.forget(pane)),
      Effect.catch((error) => Effect.logWarning(error.message)),
    )
  })

  const startClaude = (
    kind: AgentKind,
    folder: string,
    pane: PaneId,
    liveNames: readonly string[],
  ) =>
    afterCreation(
      herdr.request(AgentStartMethod, { name: mintAgentName(liveNames), kind, pane_id: pane }).pipe(
        Effect.retry({
          while: isPaneBusy,
          schedule: Schedule.spaced(SLOWEST_MEASURED_SHELL_SPAWN).pipe(
            Schedule.upTo({ duration: PANE_BUSY_RETRY_LIMIT }),
          ),
        }),
      ),
      (refusal) => new AgentNotStarted({ folder, ...refusal }),
    ).pipe(
      Effect.andThen(
        afterCreation(
          herdr.request(AgentWaitMethod, {
            target: pane,
            until: ['idle', 'blocked'],
            timeout_ms: Duration.toMillis(AGENT_READY_TIMEOUT),
          }),
          (refusal) => new AgentNotStarted({ folder, ...refusal }),
        ),
      ),
      Effect.tapError((error) =>
        Match.value(error).pipe(
          Match.tag('AgentNotStarted', () => closeQuietly(pane)),
          Match.orElse(() => Effect.void),
        ),
      ),
    )

  const deliverTask = (pane: PaneId, task: Option.Option<string>) =>
    Option.match(task, {
      onNone: () => Effect.void,
      onSome: (text) =>
        afterCreation(
          herdr.request(AgentPromptMethod, {
            target: pane,
            text,
            wait: { until: ['working', 'blocked'] },
          }),
          (refusal) => new TaskNotDelivered({ pane, ...refusal }),
        ),
    })

  const launchIn = Effect.fn('AgentLauncher.launchIn')(function* (
    command: LaunchCommand,
    launched: LaunchedPane,
    liveNames: readonly string[],
  ) {
    yield* remember(launched.pane)
    yield* startClaude(command.kind, command.folder, launched.pane, liveNames)
    yield* Option.match(launched.herdrRootPane, {
      onNone: () => Effect.void,
      onSome: closeQuietly,
    })
    yield* deliverTask(launched.pane, command.task)

    return new AgentStarted({ pane: launched.pane })
  })

  const openPane = Effect.fn('AgentLauncher.openPane')(function* (
    start: StartAgent,
    snapshot: SessionSnapshot,
  ) {
    const created = yield* Option.match(workspaceWithFolder(snapshot, start.folder), {
      onNone: () =>
        creating(
          herdr.request(WorkspaceCreateMethod, {
            cwd: start.folder,
            env: SCRUBBED_ENVIRONMENT,
          }),
        ),
      onSome: (workspace) =>
        creating(
          herdr.request(TabCreateMethod, {
            workspace_id: workspace.workspace_id,
            cwd: start.folder,
            env: SCRUBBED_ENVIRONMENT,
          }),
        ),
    })
    const launched: LaunchedPane = {
      pane: PaneId.make(created.root_pane.pane_id),
      herdrRootPane: Option.none(),
    }

    return launched
  })

  const openWorktree = (create: CreateWorktree) =>
    creating(
      herdr.request(WorktreeCreateMethod, { cwd: create.folder, branch: create.branch }),
    ).pipe(
      Effect.flatMap((worktree) =>
        afterCreation(
          herdr.request(TabCreateMethod, {
            workspace_id: worktree.workspace.workspace_id,
            cwd: worktree.worktree.path,
            env: SCRUBBED_ENVIRONMENT,
          }),
          (refusal) => new AgentNotStarted({ folder: worktree.worktree.path, ...refusal }),
        ).pipe(
          Effect.map((tab): LaunchedPane => ({
            pane: PaneId.make(tab.root_pane.pane_id),
            herdrRootPane: Option.some(PaneId.make(worktree.root_pane.pane_id)),
          })),
        ),
      ),
    )

  const launch = Effect.fn('AgentLauncher.launch')(function* (command: LaunchCommand) {
    yield* requireFolder(command.folder)
    const snapshot = yield* readSnapshot
    const launched = yield* Match.value(command).pipe(
      Match.tagsExhaustive({
        StartAgent: (start) => openPane(start, snapshot),
        CreateWorktree: openWorktree,
      }),
    )

    return yield* launchIn(command, launched, liveAgentNames(snapshot))
  })

  return AgentLauncher.of({ launch })
})

export class AgentLauncher extends Context.Service<
  AgentLauncher,
  {
    readonly launch: (
      command: LaunchCommand,
    ) => Effect.Effect<
      AgentStarted,
      | FolderNotFound
      | HerdrRefusedCommand
      | HerdrUnavailable
      | AgentNotStarted
      | TaskNotDelivered
      | CommandDeliveryUnknown
    >
  }
>()('@crook/agent/AgentLauncher') {
  static readonly layer = Layer.effect(this, make)
}
