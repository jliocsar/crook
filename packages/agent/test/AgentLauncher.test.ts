import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { describe, expect, it, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as TestClock from 'effect/testing/TestClock'

import {
  PANE_BUSY_RETRY_LIMIT,
  SCRUBBED_ENVIRONMENT,
  mintAgentName,
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
  SessionSnapshotMethod,
  TabCreateMethod,
  WorkspaceCreateMethod,
  WorktreeCreateMethod,
} from '@crook/herdr/Methods'
import {
  type AgentInfo,
  SessionSnapshot,
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
  FolderNotFound,
  TaskNotDelivered,
} from '@crook/protocol/Commands'

import {
  agentInfo,
  agentRow,
  executorWith,
  machineStateWith,
  paneInfo,
  tabInfo,
  workspaceInfo,
} from './Fixtures'

const FIRST_ACTION = IdempotencyKey.make('6a0f3c2e-7d41-4b8a-9e15-2c7f0a9d3b61')
const NEW_PANE = PaneId.make('w1:p7')
const WORKTREE_ROOT_PANE = 'w3:p1'
const WORKTREE_CLAUDE_PANE = PaneId.make('w3:p2')
const TASK = 'Fix the flaky reconnect test'

const SentLine = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, method: Schema.String, params: Schema.Unknown }),
)

const sentRequests = (requests: readonly SentRequest[]) =>
  requests.map((request) => Schema.decodeSync(SentLine)(request.line))

const snapshotOf = (
  workspaces: readonly WorkspaceInfo[],
  agents: readonly AgentInfo[] = [],
): ScriptedResponse =>
  scriptedResult(SessionSnapshotMethod, {
    type: 'session_snapshot',
    snapshot: new SessionSnapshot({
      version: '0.9.5',
      protocol: 22,
      focused_workspace_id: Option.none(),
      focused_tab_id: Option.none(),
      focused_pane_id: Option.none(),
      workspaces,
      tabs: [tabInfo],
      panes: [],
      agents,
    }),
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

const prompted = scriptedResult(AgentPromptMethod, { type: 'agent_prompted' })

const closed = scriptedResult(PaneCloseMethod, { type: 'ok' })

const startLauncher = Effect.fn('startLauncher')(function* (
  responses: readonly ScriptedResponse[],
) {
  const state = yield* SubscriptionRef.make(machineStateWith([agentRow()]))
  const sent = yield* Queue.unbounded<SentRequest>()
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const context = yield* Layer.build(
    executorWith(HerdrClient.layerTest({ responses, events, sent }), state),
  )

  return {
    executor: Context.get(context, CommandExecutor),
    createdPanes: Context.get(context, CreatedPanes),
    sent: Effect.map(Queue.clear(sent), sentRequests),
  }
})

const temporaryFolder = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem

  return yield* fileSystem.makeTempDirectoryScoped()
})

describe('mintAgentName', () => {
  it('takes the lowest crook number no live agent is called', () => {
    expect(mintAgentName([])).toBe('crook-1')
    expect(mintAgentName(['crook-1', 'reviewer'])).toBe('crook-2')
    expect(mintAgentName(['crook-2'])).toBe('crook-1')
    expect(mintAgentName(['crook-1', 'crook-2', 'crook-3'])).toBe('crook-4')
  })

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
          'agent.start',
          'agent.wait',
        ])
        expect(requests[1]?.params).toEqual({ cwd: folder, env: SCRUBBED_ENVIRONMENT })
      }),
  )

  onDisk.effect('tries agent.start again while the new pane is not at a shell yet', () =>
    Effect.gen(function* () {
      const folder = yield* temporaryFolder
      const { executor, sent } = yield* startLauncher([
        snapshotOf([workspaceAt(folder)]),
        tabCreated(NEW_PANE, 'w1', folder),
        scriptedRejection(AgentStartMethod, 'agent_pane_busy', 'not an available shell'),
        agentStarted(NEW_PANE),
        agentReady(NEW_PANE),
      ])
      const launching = yield* executor
        .execute(FIRST_ACTION, new StartAgent({ kind: 'claude', folder, task: Option.none() }))
        .pipe(Effect.forkChild)

      yield* TestClock.adjust(PANE_BUSY_RETRY_LIMIT)
      const receipt = yield* Fiber.join(launching)
      const requests = yield* sent

      expect(receipt).toEqual(new AgentStarted({ pane: NEW_PANE }))
      expect(requests.filter((request) => request.method === 'agent.start')).toHaveLength(2)
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

  onDisk.effect('closes the tab it opened when Claude never became ready, and remembers that', () =>
    Effect.gen(function* () {
      const folder = yield* temporaryFolder
      const { executor, createdPanes, sent } = yield* startLauncher([
        snapshotOf([workspaceAt(folder)]),
        tabCreated(NEW_PANE, 'w1', folder),
        agentStarted(NEW_PANE),
        scriptedRejection(AgentWaitMethod, 'timeout', 'timed out waiting for agent'),
        closed,
      ])
      const start = new StartAgent({ kind: 'claude', folder, task: Option.some(TASK) })
      const failed = yield* executor.execute(FIRST_ACTION, start).pipe(Effect.flip)
      const requests = yield* sent
      const replayed = yield* executor.execute(FIRST_ACTION, start).pipe(Effect.flip)

      expect(failed).toEqual(
        new AgentNotStarted({ folder, code: 'timeout', detail: 'timed out waiting for agent' }),
      )
      expect(requests.map((request) => request.method)).toEqual([
        'session.snapshot',
        'tab.create',
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
    'creates a worktree, starts Claude in a scrubbed tab there and closes the pane herdr opened',
    () =>
      Effect.gen(function* () {
        const folder = yield* temporaryFolder
        const checkout = `${folder}-fix-reconnect`
        const { executor, createdPanes, sent } = yield* startLauncher([
          snapshotOf([workspaceAt(folder)]),
          scriptedResult(WorktreeCreateMethod, {
            type: 'worktree_created',
            workspace: new WorkspaceInfo(
              Struct.evolve(workspaceInfo, { workspace_id: () => 'w3' }),
            ),
            tab: tabInfo,
            root_pane: newPane(WORKTREE_ROOT_PANE, 'w3', checkout),
            worktree: new WorktreeInfo({ path: checkout, branch: Option.some('fix/reconnect') }),
          }),
          tabCreated(WORKTREE_CLAUDE_PANE, 'w3', checkout),
          agentStarted(WORKTREE_CLAUDE_PANE),
          agentReady(WORKTREE_CLAUDE_PANE),
          closed,
          prompted,
        ])
        const receipt = yield* executor.execute(
          FIRST_ACTION,
          new CreateWorktree({
            kind: 'claude',
            folder,
            branch: 'fix/reconnect',
            task: Option.some(TASK),
          }),
        )
        const requests = yield* sent

        expect(receipt).toEqual(new AgentStarted({ pane: WORKTREE_CLAUDE_PANE }))
        expect(requests.map((request) => [request.method, request.params])).toEqual([
          ['session.snapshot', {}],
          ['worktree.create', { cwd: folder, branch: 'fix/reconnect' }],
          ['tab.create', { workspace_id: 'w3', cwd: checkout, env: SCRUBBED_ENVIRONMENT }],
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
})
