import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { describe, expect, it, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as TestClock from 'effect/testing/TestClock'

import {
  PANE_BUSY_RETRY_LIMIT,
  SCRUBBED_ENVIRONMENT,
  UNSET_CLAUDE_CHILD_VARIABLES,
  mintAgentName,
  worktreePathBeside,
} from '@crook/agent/AgentLauncher'
import { CommandExecutor, LAUNCH_DELIVERY_TIMEOUT } from '@crook/agent/CommandExecutor'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { AgentStarted, CreateWorktree, StartAgent } from '@crook/domain/Command'
import { IdempotencyKey, PaneId } from '@crook/domain/Ids'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type ScriptedResponse,
  type SentRequest,
  scriptedRejection,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import {
  AgentPromptMethod,
  AgentStartMethod,
  AgentWaitMethod,
  PaneCloseMethod,
  PaneSendInputMethod,
  SessionSnapshotMethod,
  TabCreateMethod,
  WorkspaceCreateMethod,
  WorktreeCreateMethod,
} from '@crook/herdr/Methods'
import {
  agentInfo,
  paneInfo,
  sessionSnapshot,
  tabInfo,
  workspaceInfo,
} from '@crook/herdr/RecordFixtures'
import {
  type AgentInfo,
  WorkspaceInfo,
  WorkspaceWorktreeInfo,
  WorktreeInfo,
} from '@crook/herdr/Records'
import {
  AGENT_READY_TIMEOUT,
  HUB_RECONNECT_BASE,
  LAUNCH_COMMAND_TIMEOUT,
} from '@crook/protocol/AgentLink'
import {
  AgentNotStarted,
  CommandDeliveryUnknown,
  FolderNotCheckout,
  FolderNotFound,
  FolderUnreadable,
  HerdrAnswerUnreadable,
  TaskNotDelivered,
} from '@crook/protocol/Commands'

import { agentRow, executorWith, machineStateWith } from './Fixtures'

const FIRST_ACTION = IdempotencyKey.make('6a0f3c2e-7d41-4b8a-9e15-2c7f0a9d3b61')
const SECOND_ACTION = IdempotencyKey.make('0c5d8e21-4b3f-4a9e-8d17-5e2f9b6a1c40')
const NEW_PANE = PaneId.make('w1:p7')
const OTHER_NEW_PANE = PaneId.make('w1:p8')
const WORKTREE_ROOT_PANE = PaneId.make('w3:p1')
const WORKTREE_CLAUDE_PANE = PaneId.make('w3:p2')
const TASK = 'Fix the flaky reconnect test'
const WORKTREE_BRANCH = 'fix/reconnect'
const NO_PERMISSIONS = 0o000
const OWNER_PERMISSIONS = 0o700

const UNREADABLE_SNAPSHOT =
  '{"id":"session.snapshot","result":{"type":"session_snapshot","snapshot":{"version":22}}}'

const SentLine = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, method: Schema.String, params: Schema.Unknown }),
)

const StartedName = Schema.Struct({ name: Schema.String })

const sentRequests = (requests: readonly SentRequest[]) =>
  requests.map((request) => Schema.decodeSync(SentLine)(request.line))

const snapshotOf = (
  workspaces: readonly WorkspaceInfo[],
  agents: readonly AgentInfo[] = [],
): ScriptedResponse =>
  scriptedResult(SessionSnapshotMethod, {
    type: 'session_snapshot',
    snapshot: sessionSnapshot(agents, [], { version: '0.9.5', workspaces }),
  })

const workspaceAt = (folder: string) =>
  new WorkspaceInfo(
    Struct.evolve(workspaceInfo, {
      worktree: () =>
        Option.some(
          new WorkspaceWorktreeInfo({
            repo_root: folder,
            checkout_path: folder,
            is_linked_worktree: false,
          }),
        ),
    }),
  )

const newPane = (pane: string, workspace: string, cwd: string) =>
  paneInfo({
    pane_id: pane,
    workspace_id: workspace,
    tab_id: `${workspace}:t2`,
    cwd: Option.some(cwd),
  })

const tabCreated = (pane: string, workspace: string, cwd: string) =>
  scriptedResult(TabCreateMethod, {
    type: 'tab_created',
    tab: tabInfo,
    root_pane: newPane(pane, workspace, cwd),
  })

const worktreeCreated = (checkout: string) =>
  scriptedResult(WorktreeCreateMethod, {
    type: 'worktree_created',
    workspace: new WorkspaceInfo(Struct.evolve(workspaceInfo, { workspace_id: () => 'w3' })),
    tab: tabInfo,
    root_pane: newPane(WORKTREE_ROOT_PANE, 'w3', checkout),
    worktree: new WorktreeInfo({ path: checkout, branch: Option.some(WORKTREE_BRANCH) }),
  })

const launchedAgent = (pane: string) =>
  agentInfo({ pane_id: pane, agent_status: 'unknown', state_change_seq: 0 })

const agentStarted = (pane: string) =>
  scriptedResult(AgentStartMethod, {
    type: 'agent_started',
    agent: launchedAgent(pane),
    argv: ['claude'],
  })

const agentReady = (pane: string) =>
  scriptedResult(AgentWaitMethod, {
    type: 'agent_info',
    agent: agentInfo({ pane_id: pane, agent_status: 'idle', state_change_seq: 1 }),
  })

const inputSent = scriptedResult(PaneSendInputMethod, { type: 'ok' })

const prompted = scriptedResult(AgentPromptMethod, { type: 'agent_prompted' })

const closed = scriptedResult(PaneCloseMethod, { type: 'ok' })

const unsetSent = (pane: PaneId) => ({
  id: 'pane.send_input',
  method: 'pane.send_input',
  params: { pane_id: pane, text: UNSET_CLAUDE_CHILD_VARIABLES, keys: ['enter'] },
})

const startLauncher = Effect.fn('startLauncher')(function* (
  responses: readonly ScriptedResponse[],
) {
  const state = yield* SubscriptionRef.make(machineStateWith([agentRow()]))
  const sent = yield* Queue.unbounded<SentRequest>()
  const alreadyTaken = yield* Ref.make<readonly SentRequest[]>([])
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const context = yield* Layer.build(
    executorWith(HerdrClient.layerTest({ responses, events, sent }), state),
  )

  return {
    executor: Context.get(context, CommandExecutor),
    createdPanes: Context.get(context, CreatedPanes),
    sent: Effect.zipWith(Ref.getAndSet(alreadyTaken, []), Queue.clear(sent), (taken, rest) =>
      sentRequests(Arr.appendAll(taken, rest)),
    ),
    untilSent: (method: string) =>
      Queue.take(sent).pipe(
        Effect.tap((request) => Ref.update(alreadyTaken, Arr.append(request))),
        Effect.repeat({ until: (request) => request.method === method }),
      ),
  }
})

const temporaryFolder = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem

  return yield* fileSystem.makeTempDirectoryScoped()
})

const gitCheckout = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const folder = yield* temporaryFolder

  yield* fileSystem.makeDirectory(`${folder}/.git`)
  yield* fileSystem.writeFileString(`${folder}/.git/HEAD`, 'ref: refs/heads/main\n')

  return folder
})

const createWorktreeIn = (folder: string) =>
  new CreateWorktree({
    kind: 'claude',
    folder,
    branch: WORKTREE_BRANCH,
    task: Option.some(TASK),
  })

describe('mintAgentName', () => {
  it('takes the lowest crook number no live agent is called', () => {
    expect(mintAgentName([])).toBe('crook-1')
    expect(mintAgentName(['crook-1', 'reviewer'])).toBe('crook-2')
    expect(mintAgentName(['crook-2'])).toBe('crook-1')
    expect(mintAgentName(['crook-1', 'crook-2', 'crook-3'])).toBe('crook-4')
  })
})

describe('worktreePathBeside', () => {
  it('puts the checkout next to the one it came from, named like herdr names its own', () => {
    expect(worktreePathBeside('/home/jliocsar/Projects/crook', 'fix/flaky-reconnect')).toBe(
      '/home/jliocsar/Projects/crook-fix-flaky-reconnect',
    )
  })
})

describe('launch bounds', () => {
  it('leaves the hub time to hear how a launch ended', () => {
    expect(
      Duration.isLessThan(
        Duration.sum(LAUNCH_DELIVERY_TIMEOUT, HUB_RECONNECT_BASE),
        LAUNCH_COMMAND_TIMEOUT,
      ),
    ).toBe(true)
  })
})

layer(BunFileSystem.layer)('AgentLauncher', (onDisk) => {
  onDisk.effect(
    'starts Claude in a new tab of the workspace that has the folder, then sends the task',
    () =>
      Effect.gen(function* () {
        const folder = yield* temporaryFolder
        const { executor, createdPanes, sent } = yield* startLauncher([
          snapshotOf([workspaceAt(folder)], [agentInfo({ name: Option.some('crook-1') })]),
          tabCreated(NEW_PANE, 'w1', folder),
          inputSent,
          agentStarted(NEW_PANE),
          agentReady(NEW_PANE),
          prompted,
        ])
        const receipt = yield* executor.execute(
          FIRST_ACTION,
          new StartAgent({ kind: 'claude', folder, task: Option.some(TASK) }),
        )

        expect(receipt).toEqual(new AgentStarted({ pane: NEW_PANE }))
        expect(yield* sent).toEqual([
          { id: 'session.snapshot', method: 'session.snapshot', params: {} },
          {
            id: 'tab.create',
            method: 'tab.create',
            params: { workspace_id: 'w1', cwd: folder, env: SCRUBBED_ENVIRONMENT },
          },
          { id: 'session.snapshot', method: 'session.snapshot', params: {} },
          unsetSent(NEW_PANE),
          {
            id: 'agent.start',
            method: 'agent.start',
            params: { name: 'crook-2', kind: 'claude', pane_id: NEW_PANE },
          },
          {
            id: 'agent.wait',
            method: 'agent.wait',
            params: {
              target: NEW_PANE,
              until: ['idle', 'blocked'],
              timeout_ms: Duration.toMillis(AGENT_READY_TIMEOUT),
            },
          },
          {
            id: 'agent.prompt',
            method: 'agent.prompt',
            params: { target: NEW_PANE, text: TASK, wait: { until: ['working', 'blocked'] } },
          },
        ])
        expect(HashSet.has(yield* createdPanes.current, NEW_PANE)).toBe(true)
      }),
  )

  onDisk.effect(
    'opens a workspace when none has the folder, and types nothing without a task',
    () =>
      Effect.gen(function* () {
        const folder = yield* temporaryFolder
        const { executor, sent } = yield* startLauncher([
          snapshotOf([workspaceInfo]),
          scriptedResult(WorkspaceCreateMethod, {
            type: 'workspace_created',
            workspace: new WorkspaceInfo(
              Struct.evolve(workspaceInfo, { workspace_id: () => 'w2' }),
            ),
            tab: tabInfo,
            root_pane: newPane('w2:p1', 'w2', folder),
          }),
          inputSent,
          agentStarted('w2:p1'),
          agentReady('w2:p1'),
        ])
        const receipt = yield* executor.execute(
          FIRST_ACTION,
          new StartAgent({ kind: 'claude', folder, task: Option.none() }),
        )
        const requests = yield* sent

        expect(receipt).toEqual(new AgentStarted({ pane: PaneId.make('w2:p1') }))
        expect(requests.map((request) => request.method)).toEqual([
          'session.snapshot',
          'workspace.create',
          'session.snapshot',
          'pane.send_input',
          'agent.start',
          'agent.wait',
        ])
        expect(requests[1]?.params).toEqual({ cwd: folder, env: SCRUBBED_ENVIRONMENT })
      }),
  )

  onDisk.effect('reads a typed folder with a trailing slash or a dot as the folder itself', () =>
    Effect.gen(function* () {
      const folder = yield* temporaryFolder
      const { executor, sent } = yield* startLauncher([
        snapshotOf([workspaceAt(folder)]),
        tabCreated(NEW_PANE, 'w1', folder),
        inputSent,
        agentStarted(NEW_PANE),
        agentReady(NEW_PANE),
      ])
      const receipt = yield* executor.execute(
        FIRST_ACTION,
        new StartAgent({ kind: 'claude', folder: `${folder}/./`, task: Option.none() }),
      )
      const requests = yield* sent

      expect(receipt).toEqual(new AgentStarted({ pane: NEW_PANE }))
      expect(requests[1]).toEqual({
        id: 'tab.create',
        method: 'tab.create',
        params: { workspace_id: 'w1', cwd: folder, env: SCRUBBED_ENVIRONMENT },
      })
    }),
  )

  onDisk.effect(
    'refuses to go on when herdr answers the first read with a snapshot it cannot read',
    () =>
      Effect.gen(function* () {
        const folder = yield* temporaryFolder
        const { executor, sent } = yield* startLauncher([
          { method: SessionSnapshotMethod.name, line: UNREADABLE_SNAPSHOT },
          { method: SessionSnapshotMethod.name, line: UNREADABLE_SNAPSHOT },
        ])
        const start = new StartAgent({ kind: 'claude', folder, task: Option.some(TASK) })
        const refused = yield* executor.execute(FIRST_ACTION, start).pipe(Effect.flip)
        const requests = yield* sent
        const retried = yield* executor.execute(FIRST_ACTION, start).pipe(Effect.flip)

        expect(refused).toBeInstanceOf(HerdrAnswerUnreadable)
        expect(refused).toMatchObject({ method: 'session.snapshot' })
        expect(requests.map((request) => request.method)).toEqual(['session.snapshot'])
        expect(retried).toBeInstanceOf(HerdrAnswerUnreadable)
        expect(yield* sent).toHaveLength(1)
      }),
  )

  onDisk.effect('tries agent.start again while the new pane is not at a shell yet', () =>
    Effect.gen(function* () {
      const folder = yield* temporaryFolder
      const { executor, sent, untilSent } = yield* startLauncher([
        snapshotOf([workspaceAt(folder)]),
        tabCreated(NEW_PANE, 'w1', folder),
        inputSent,
        scriptedRejection(AgentStartMethod, 'agent_pane_busy', 'not an available shell'),
        agentStarted(NEW_PANE),
        agentReady(NEW_PANE),
      ])
      const launching = yield* executor
        .execute(FIRST_ACTION, new StartAgent({ kind: 'claude', folder, task: Option.none() }))
        .pipe(Effect.forkChild)

      yield* untilSent(AgentStartMethod.name)
      yield* TestClock.adjust(PANE_BUSY_RETRY_LIMIT)
      const receipt = yield* Fiber.join(launching)
      const requests = yield* sent

      expect(receipt).toEqual(new AgentStarted({ pane: NEW_PANE }))
      expect(requests.filter((request) => request.method === 'agent.start')).toHaveLength(2)
    }),
  )

  onDisk.effect('gives two launches running at once different agent names', () =>
    Effect.gen(function* () {
      const folder = yield* temporaryFolder
      const { executor, sent, untilSent } = yield* startLauncher([
        snapshotOf([workspaceAt(folder)]),
        tabCreated(NEW_PANE, 'w1', folder),
        tabCreated(OTHER_NEW_PANE, 'w1', folder),
        inputSent,
        scriptedRejection(AgentStartMethod, 'agent_pane_busy', 'not an available shell'),
        agentStarted(NEW_PANE),
        agentReady(NEW_PANE),
      ])
      const start = new StartAgent({ kind: 'claude', folder, task: Option.none() })
      const launching = yield* Effect.all(
        [executor.execute(FIRST_ACTION, start), executor.execute(SECOND_ACTION, start)],
        { concurrency: 'unbounded' },
      ).pipe(Effect.forkChild)

      yield* untilSent(AgentStartMethod.name)
      yield* untilSent(AgentStartMethod.name)
      yield* TestClock.adjust(PANE_BUSY_RETRY_LIMIT)
      const receipts = yield* Fiber.join(launching)
      const names = (yield* sent)
        .filter((request) => request.method === 'agent.start')
        .map((request) => Schema.decodeUnknownSync(StartedName)(request.params).name)

      expect(receipts.map((receipt) => receipt.pane).toSorted()).toEqual([NEW_PANE, OTHER_NEW_PANE])
      expect(Arr.dedupe(names).toSorted()).toEqual(['crook-1', 'crook-2'])
    }),
  )

  onDisk.effect('refuses a folder that does not exist and asks herdr for nothing', () =>
    Effect.gen(function* () {
      const folder = `${yield* temporaryFolder}/gone`
      const { executor, sent } = yield* startLauncher([snapshotOf([workspaceInfo])])
      const refused = yield* executor
        .execute(FIRST_ACTION, new StartAgent({ kind: 'claude', folder, task: Option.none() }))
        .pipe(Effect.flip)

      expect(refused).toEqual(new FolderNotFound({ folder }))
      expect(yield* sent).toEqual([])
    }),
  )

  onDisk.effect('says a folder it may not look at is unreadable, not missing', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const parent = yield* temporaryFolder
      const folder = `${parent}/locked`

      yield* fileSystem.makeDirectory(folder)
      const { executor, sent } = yield* startLauncher([snapshotOf([workspaceInfo])])
      const refused = yield* fileSystem
        .chmod(parent, NO_PERMISSIONS)
        .pipe(
          Effect.andThen(
            executor
              .execute(
                FIRST_ACTION,
                new StartAgent({ kind: 'claude', folder, task: Option.none() }),
              )
              .pipe(Effect.flip),
          ),
          Effect.ensuring(Effect.orDie(fileSystem.chmod(parent, OWNER_PERMISSIONS))),
        )

      expect(refused).toBeInstanceOf(FolderUnreadable)
      expect(refused).toMatchObject({ folder })
      expect(yield* sent).toEqual([])
    }),
  )

  onDisk.effect('closes the tab it opened when Claude never became ready, and remembers that', () =>
    Effect.gen(function* () {
      const folder = yield* temporaryFolder
      const { executor, createdPanes, sent } = yield* startLauncher([
        snapshotOf([workspaceAt(folder)]),
        tabCreated(NEW_PANE, 'w1', folder),
        inputSent,
        agentStarted(NEW_PANE),
        scriptedRejection(AgentWaitMethod, 'timeout', 'timed out waiting for agent'),
        closed,
      ])
      const start = new StartAgent({ kind: 'claude', folder, task: Option.some(TASK) })
      const failed = yield* executor.execute(FIRST_ACTION, start).pipe(Effect.flip)
      const requests = yield* sent
      const replayed = yield* executor.execute(FIRST_ACTION, start).pipe(Effect.flip)

      expect(failed).toEqual(
        new AgentNotStarted({
          folder,
          worktree: Option.none(),
          code: 'timeout',
          detail: 'timed out waiting for agent',
        }),
      )
      expect(requests.map((request) => request.method)).toEqual([
        'session.snapshot',
        'tab.create',
        'session.snapshot',
        'pane.send_input',
        'agent.start',
        'agent.wait',
        'pane.close',
      ])
      expect(HashSet.has(yield* createdPanes.current, NEW_PANE)).toBe(false)
      expect(replayed).toEqual(failed)
      expect(yield* sent).toEqual([])
    }),
  )

  onDisk.effect('keeps Claude and says the task did not arrive when herdr refuses the prompt', () =>
    Effect.gen(function* () {
      const folder = yield* temporaryFolder
      const { executor, createdPanes, sent } = yield* startLauncher([
        snapshotOf([workspaceAt(folder)]),
        tabCreated(NEW_PANE, 'w1', folder),
        inputSent,
        agentStarted(NEW_PANE),
        agentReady(NEW_PANE),
        scriptedRejection(AgentPromptMethod, 'agent_blocked', 'agent is blocked'),
      ])
      const failed = yield* executor
        .execute(FIRST_ACTION, new StartAgent({ kind: 'claude', folder, task: Option.some(TASK) }))
        .pipe(Effect.flip)
      const requests = yield* sent

      expect(failed).toEqual(
        new TaskNotDelivered({ pane: NEW_PANE, code: 'agent_blocked', detail: 'agent is blocked' }),
      )
      expect(requests.map((request) => request.method)).not.toContain('pane.close')
      expect(HashSet.has(yield* createdPanes.current, NEW_PANE)).toBe(true)
    }),
  )

  onDisk.effect('counts a typed task Claude was slow to start on as delivered', () =>
    Effect.gen(function* () {
      const folder = yield* temporaryFolder
      const { executor, sent } = yield* startLauncher([
        snapshotOf([workspaceAt(folder)]),
        tabCreated(NEW_PANE, 'w1', folder),
        inputSent,
        agentStarted(NEW_PANE),
        agentReady(NEW_PANE),
        scriptedRejection(AgentPromptMethod, 'agent_prompt_stalled', 'did not start working'),
      ])
      const receipt = yield* executor.execute(
        FIRST_ACTION,
        new StartAgent({ kind: 'claude', folder, task: Option.some(TASK) }),
      )
      const requests = yield* sent

      expect(receipt).toEqual(new AgentStarted({ pane: NEW_PANE }))
      expect(requests.filter((request) => request.method === 'agent.prompt')).toHaveLength(1)
    }),
  )

  onDisk.effect('reports an unknown delivery when herdr hangs up while creating the tab', () =>
    Effect.gen(function* () {
      const folder = yield* temporaryFolder
      const { executor } = yield* startLauncher([snapshotOf([workspaceAt(folder)])])
      const failed = yield* executor
        .execute(FIRST_ACTION, new StartAgent({ kind: 'claude', folder, task: Option.none() }))
        .pipe(Effect.flip)

      expect(failed).toEqual(new CommandDeliveryUnknown())
    }),
  )

  onDisk.effect(
    'creates a worktree beside the checkout, starts Claude in a tab there, closes the herdr pane',
    () =>
      Effect.gen(function* () {
        const folder = yield* gitCheckout
        const checkout = worktreePathBeside(folder, WORKTREE_BRANCH)
        const { executor, createdPanes, sent } = yield* startLauncher([
          worktreeCreated(checkout),
          tabCreated(WORKTREE_CLAUDE_PANE, 'w3', checkout),
          snapshotOf([workspaceAt(folder)]),
          inputSent,
          agentStarted(WORKTREE_CLAUDE_PANE),
          agentReady(WORKTREE_CLAUDE_PANE),
          closed,
          prompted,
        ])
        const receipt = yield* executor.execute(FIRST_ACTION, createWorktreeIn(folder))
        const requests = yield* sent

        expect(receipt).toEqual(new AgentStarted({ pane: WORKTREE_CLAUDE_PANE }))
        expect(requests.map((request) => [request.method, request.params])).toEqual([
          ['worktree.create', { cwd: folder, branch: WORKTREE_BRANCH, path: checkout }],
          ['tab.create', { workspace_id: 'w3', cwd: checkout, env: SCRUBBED_ENVIRONMENT }],
          ['session.snapshot', {}],
          ['pane.send_input', unsetSent(WORKTREE_CLAUDE_PANE).params],
          ['agent.start', { name: 'crook-1', kind: 'claude', pane_id: WORKTREE_CLAUDE_PANE }],
          [
            'agent.wait',
            {
              target: WORKTREE_CLAUDE_PANE,
              until: ['idle', 'blocked'],
              timeout_ms: Duration.toMillis(AGENT_READY_TIMEOUT),
            },
          ],
          ['pane.close', { pane_id: WORKTREE_ROOT_PANE }],
          [
            'agent.prompt',
            {
              target: WORKTREE_CLAUDE_PANE,
              text: TASK,
              wait: { until: ['working', 'blocked'] },
            },
          ],
        ])
        expect(Array.from(yield* createdPanes.current)).toEqual([WORKTREE_CLAUDE_PANE])
      }),
  )

  onDisk.effect('closes both worktree panes when Claude never became ready there', () =>
    Effect.gen(function* () {
      const folder = yield* gitCheckout
      const checkout = worktreePathBeside(folder, WORKTREE_BRANCH)
      const { executor, createdPanes, sent } = yield* startLauncher([
        worktreeCreated(checkout),
        tabCreated(WORKTREE_CLAUDE_PANE, 'w3', checkout),
        snapshotOf([workspaceAt(folder)]),
        inputSent,
        agentStarted(WORKTREE_CLAUDE_PANE),
        scriptedRejection(AgentWaitMethod, 'timeout', 'timed out waiting for agent'),
        closed,
      ])
      const failed = yield* executor
        .execute(FIRST_ACTION, createWorktreeIn(folder))
        .pipe(Effect.flip)
      const requests = yield* sent

      expect(failed).toEqual(
        new AgentNotStarted({
          folder: checkout,
          worktree: Option.some(checkout),
          code: 'timeout',
          detail: 'timed out waiting for agent',
        }),
      )
      expect(
        requests
          .filter((request) => request.method === 'pane.close')
          .map((request) => request.params),
      ).toEqual([{ pane_id: WORKTREE_CLAUDE_PANE }, { pane_id: WORKTREE_ROOT_PANE }])
      expect(HashSet.size(yield* createdPanes.current)).toBe(0)
    }),
  )

  onDisk.effect('refuses a worktree from a folder outside git and asks herdr for nothing', () =>
    Effect.gen(function* () {
      const folder = yield* temporaryFolder
      const { executor, sent } = yield* startLauncher([worktreeCreated(folder)])
      const refused = yield* executor
        .execute(FIRST_ACTION, createWorktreeIn(folder))
        .pipe(Effect.flip)

      expect(refused).toEqual(new FolderNotCheckout({ folder }))
      expect(yield* sent).toEqual([])
    }),
  )
})
