import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Record from 'effect/Record'
import * as Ref from 'effect/Ref'
import * as Schedule from 'effect/Schedule'

import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { type AgentKind, AgentStarted, type LaunchCommand } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import {
  HerdrClient,
  type HerdrConnectionClosed,
  type HerdrRequestError,
  type HerdrRequestInvalid,
  type HerdrResponseInvalid,
  type HerdrUnreachable,
} from '@crook/herdr/HerdrClient'
import {
  AgentPromptMethod,
  AgentStartMethod,
  AgentWaitMethod,
  PaneCloseMethod,
  PaneSendInputMethod,
  TabCreateMethod,
  WorkspaceCreateMethod,
  WorktreeCreateMethod,
} from '@crook/herdr/Methods'
import type { PaneInfo, SessionSnapshot } from '@crook/herdr/Records'
import { AGENT_READY_TIMEOUT } from '@crook/protocol/AgentLink'
import {
  AgentNotStarted,
  CommandDeliveryUnknown,
  FolderNotCheckout,
  FolderNotFound,
  FolderUnreadable,
  HerdrAnswerUnreadable,
  HerdrRefusedCommand,
  HerdrUnavailable,
  TaskNotDelivered,
} from '@crook/protocol/Commands'

interface LaunchedPane {
  readonly pane: PaneId
  readonly folder: string
  readonly worktree: Option.Option<string>
  readonly herdrRootPane: Option.Option<PaneId>
}

interface Refusal {
  readonly code: string
  readonly detail: string
}

interface TransportFailures<Failure> {
  readonly unreachable: () => Effect.Effect<never, Failure>
  readonly lost: () => Effect.Effect<never, Failure>
  readonly unreadable: (invalid: HerdrResponseInvalid) => Effect.Effect<never, Failure>
}

type HerdrRefusalError = Exclude<
  HerdrRequestError,
  HerdrUnreachable | HerdrConnectionClosed | HerdrResponseInvalid | HerdrRequestInvalid
>

const AGENT_NAME_PREFIX = 'crook-'
const FIRST_AGENT_NUMBER = 1
const ENTER_KEY = 'enter'
const BRANCH_SEPARATOR = '/'
const WORKTREE_NAME_SEPARATOR = '-'
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

export const UNSET_CLAUDE_CHILD_VARIABLES = ` unset ${CLAUDE_CHILD_VARIABLES.join(' ')}`

export const SCRUBBED_ENVIRONMENT: Record.ReadonlyRecord<string, string> = Record.fromEntries(
  Arr.map(CLAUDE_CHILD_VARIABLES, (name) => [name, ''] as const),
)

const NOTHING_SENT: TransportFailures<HerdrUnavailable | HerdrAnswerUnreadable> = {
  unreachable: () => Effect.fail(new HerdrUnavailable()),
  lost: () => Effect.fail(new HerdrUnavailable()),
  unreadable: (invalid) =>
    Effect.fail(new HerdrAnswerUnreadable({ method: invalid.method, issue: invalid.issue })),
}

const CREATING_PANE: TransportFailures<HerdrUnavailable | CommandDeliveryUnknown> = {
  unreachable: () => Effect.fail(new HerdrUnavailable()),
  lost: () => Effect.fail(new CommandDeliveryUnknown()),
  unreadable: () => Effect.fail(new CommandDeliveryUnknown()),
}

const PANE_OPENED: TransportFailures<CommandDeliveryUnknown> = {
  unreachable: () => Effect.fail(new CommandDeliveryUnknown()),
  lost: () => Effect.fail(new CommandDeliveryUnknown()),
  unreadable: () => Effect.fail(new CommandDeliveryUnknown()),
}

const agentName = (number: number) => `${AGENT_NAME_PREFIX}${number}`

export const mintAgentName = (takenNames: readonly string[]): string => {
  const candidates = pipe(
    Arr.range(FIRST_AGENT_NUMBER, takenNames.length + FIRST_AGENT_NUMBER),
    Arr.map(agentName),
  )

  return Option.getOrElse(
    Arr.findFirst(candidates, (candidate) => !Arr.contains(takenNames, candidate)),
    () => Arr.lastNonEmpty(candidates),
  )
}

export const worktreePathBeside = (checkoutRoot: string, branch: string): string =>
  `${checkoutRoot}${WORKTREE_NAME_SEPARATOR}${branch.replaceAll(BRANCH_SEPARATOR, WORKTREE_NAME_SEPARATOR)}`

const workingDirectoryOfPane = (pane: PaneInfo): Option.Option<string> =>
  Option.orElse(pane.foreground_cwd, () => pane.cwd)

const workspaceWithFolder = (snapshot: SessionSnapshot, folder: string) =>
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
      HerdrPromptStalled: (stalled) => ({ code: 'agent_prompt_stalled', detail: stalled.detail }),
    }),
  )

const fromHerdr = <Success, Lost, Refused>(
  request: Effect.Effect<Success, HerdrRequestError>,
  transport: TransportFailures<Lost>,
  refused: (refusal: Refusal) => Refused,
) => {
  const refuse = (error: HerdrRefusalError) => Effect.fail(refused(refusalOf(error)))

  return request.pipe(
    Effect.catchTags({
      HerdrUnreachable: transport.unreachable,
      HerdrConnectionClosed: transport.lost,
      HerdrResponseInvalid: transport.unreadable,
      HerdrRequestInvalid: (invalid) => Effect.die(invalid),
      HerdrRequestRejected: refuse,
      HerdrPaneNotFound: refuse,
      HerdrAgentNotFound: refuse,
      HerdrPaneBusy: refuse,
      HerdrPromptStalled: refuse,
    }),
  )
}

const refusedCommand = (refusal: Refusal) => new HerdrRefusedCommand(refusal)

const notStartedIn = (launched: LaunchedPane) => (refusal: Refusal) =>
  new AgentNotStarted({ folder: launched.folder, worktree: launched.worktree, ...refusal })

const reserveNameBeside = (
  reservedNames: Ref.Ref<HashSet.HashSet<string>>,
  liveNames: readonly string[],
) =>
  Ref.modify(reservedNames, (reserved) => {
    const name = mintAgentName(Arr.appendAll(liveNames, Arr.fromIterable(reserved)))

    return [name, HashSet.add(reserved, name)] as const
  })

const isPaneBusy = (error: HerdrRequestError) =>
  Match.value(error).pipe(
    Match.tag('HerdrPaneBusy', () => true),
    Match.orElse(() => false),
  )

const make = Effect.gen(function* () {
  const herdr = yield* HerdrClient
  const createdPanes = yield* CreatedPanes
  const gitBranches = yield* GitBranches
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const reservedNames = yield* Ref.make(HashSet.empty<string>())

  const requireFolder = (folder: string) =>
    fileSystem.stat(folder).pipe(
      Effect.catchReason('PlatformError', 'NotFound', () =>
        Effect.fail(new FolderNotFound({ folder })),
      ),
      Effect.catchTag('PlatformError', (error) =>
        Effect.fail(new FolderUnreadable({ folder, reason: error.message })),
      ),
      Effect.filterOrFail(
        (info) => info.type === 'Directory',
        () => new FolderNotFound({ folder }),
      ),
    )

  const requireCheckout = (folder: string) =>
    gitBranches.checkoutOf(folder).pipe(
      Effect.mapError(
        (error) => new FolderUnreadable({ folder, reason: `could not read ${error.path}` }),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new FolderNotCheckout({ folder })),
          onSome: Effect.succeed,
        }),
      ),
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

  const closeLaunched = (launched: LaunchedPane) =>
    Effect.forEach(
      Arr.prepend(Option.toArray(launched.herdrRootPane), launched.pane),
      closeQuietly,
      { discard: true },
    )

  const reserveName = (launched: LaunchedPane) =>
    fromHerdr(herdr.snapshot, PANE_OPENED, notStartedIn(launched)).pipe(
      Effect.flatMap((snapshot) => reserveNameBeside(reservedNames, liveAgentNames(snapshot))),
    )

  const releaseName = (name: string) => Ref.update(reservedNames, HashSet.remove(name))

  const runClaude = (kind: AgentKind, launched: LaunchedPane, name: string) =>
    fromHerdr(
      herdr.request(PaneSendInputMethod, {
        pane_id: launched.pane,
        text: UNSET_CLAUDE_CHILD_VARIABLES,
        keys: [ENTER_KEY],
      }),
      PANE_OPENED,
      notStartedIn(launched),
    ).pipe(
      Effect.andThen(
        fromHerdr(
          herdr.request(AgentStartMethod, { name, kind, pane_id: launched.pane }).pipe(
            Effect.retry({
              while: isPaneBusy,
              schedule: Schedule.spaced(SLOWEST_MEASURED_SHELL_SPAWN).pipe(
                Schedule.upTo({ duration: PANE_BUSY_RETRY_LIMIT }),
              ),
            }),
          ),
          PANE_OPENED,
          notStartedIn(launched),
        ),
      ),
      Effect.andThen(
        fromHerdr(
          herdr.request(AgentWaitMethod, {
            target: launched.pane,
            until: ['idle', 'blocked'],
            timeout_ms: Duration.toMillis(AGENT_READY_TIMEOUT),
          }),
          PANE_OPENED,
          notStartedIn(launched),
        ),
      ),
    )

  const startClaude = (kind: AgentKind, launched: LaunchedPane) =>
    Effect.acquireUseRelease(
      reserveName(launched),
      (name) => runClaude(kind, launched, name),
      releaseName,
    ).pipe(Effect.tapErrorTag('AgentNotStarted', () => closeLaunched(launched)))

  const deliverTask = (pane: PaneId, task: Option.Option<string>) =>
    Option.match(task, {
      onNone: () => Effect.void,
      onSome: (text) =>
        fromHerdr(
          herdr
            .request(AgentPromptMethod, {
              target: pane,
              text,
              wait: { until: ['working', 'blocked'] },
            })
            .pipe(
              Effect.catchTag('HerdrPromptStalled', (stalled) => Effect.logInfo(stalled.message)),
            ),
          PANE_OPENED,
          (refusal) => new TaskNotDelivered({ pane, ...refusal }),
        ),
    })

  const launchIn = Effect.fn('AgentLauncher.launchIn')(function* (
    command: LaunchCommand,
    launched: LaunchedPane,
  ) {
    yield* remember(launched.pane)
    yield* startClaude(command.kind, launched)
    yield* Effect.forEach(Option.toArray(launched.herdrRootPane), closeQuietly, { discard: true })
    yield* deliverTask(launched.pane, command.task)

    return new AgentStarted({ pane: launched.pane })
  })

  const openPane = Effect.fn('AgentLauncher.openPane')(function* (folder: string) {
    const snapshot = yield* fromHerdr(herdr.snapshot, NOTHING_SENT, refusedCommand)
    const created = yield* Option.match(workspaceWithFolder(snapshot, folder), {
      onNone: () =>
        fromHerdr(
          herdr.request(WorkspaceCreateMethod, { cwd: folder, env: SCRUBBED_ENVIRONMENT }),
          CREATING_PANE,
          refusedCommand,
        ),
      onSome: (workspace) =>
        fromHerdr(
          herdr.request(TabCreateMethod, {
            workspace_id: workspace.workspace_id,
            cwd: folder,
            env: SCRUBBED_ENVIRONMENT,
          }),
          CREATING_PANE,
          refusedCommand,
        ),
    })
    const launched: LaunchedPane = {
      pane: PaneId.make(created.root_pane.pane_id),
      folder,
      worktree: Option.none(),
      herdrRootPane: Option.none(),
    }

    return launched
  })

  const openWorktree = Effect.fn('AgentLauncher.openWorktree')(function* (
    folder: string,
    branch: string,
  ) {
    const checkout = yield* requireCheckout(folder)
    const created = yield* fromHerdr(
      herdr.request(WorktreeCreateMethod, {
        cwd: folder,
        branch,
        path: worktreePathBeside(checkout.root, branch),
      }),
      CREATING_PANE,
      refusedCommand,
    )
    const herdrRootPane = PaneId.make(created.root_pane.pane_id)
    const worktree = created.worktree.path

    yield* remember(herdrRootPane)

    const tab = yield* fromHerdr(
      herdr.request(TabCreateMethod, {
        workspace_id: created.workspace.workspace_id,
        cwd: worktree,
        env: SCRUBBED_ENVIRONMENT,
      }),
      PANE_OPENED,
      (refusal) =>
        new AgentNotStarted({ folder: worktree, worktree: Option.some(worktree), ...refusal }),
    ).pipe(Effect.tapErrorTag('AgentNotStarted', () => closeQuietly(herdrRootPane)))
    const launched: LaunchedPane = {
      pane: PaneId.make(tab.root_pane.pane_id),
      folder: worktree,
      worktree: Option.some(worktree),
      herdrRootPane: Option.some(herdrRootPane),
    }

    return launched
  })

  const launch = Effect.fn('AgentLauncher.launch')(function* (command: LaunchCommand) {
    const folder = path.resolve(command.folder)

    yield* requireFolder(folder)
    const launched = yield* Match.value(command).pipe(
      Match.tagsExhaustive({
        StartAgent: () => openPane(folder),
        CreateWorktree: (create) => openWorktree(folder, create.branch),
      }),
    )

    return yield* launchIn(command, launched)
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
      | FolderUnreadable
      | FolderNotCheckout
      | HerdrRefusedCommand
      | HerdrUnavailable
      | HerdrAnswerUnreadable
      | AgentNotStarted
      | TaskNotDelivered
      | CommandDeliveryUnknown
    >
  }
>()('@crook/agent/AgentLauncher') {
  static readonly layer = Layer.effect(this, make)
}
