import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import type * as SubscriptionRef from 'effect/SubscriptionRef'

import * as AgentDaemon from '@crook/agent/AgentDaemon'
import { AuditLog } from '@crook/agent/AuditLog'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { AgentRow } from '@crook/domain/AgentRow'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  HerdrConnectionId,
  MachineId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from '@crook/domain/Ids'
import { AuditPolicy, DEFAULT_AUDIT_ARGUMENT_LIMIT } from '@crook/domain/Audit'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import type { HerdrClient } from '@crook/herdr/HerdrClient'

export interface ExecutorOptions {
  readonly created?: Iterable<PaneId>
  readonly invalidate?: Effect.Effect<void>
  readonly audit?: Layer.Layer<AuditLog>
}

export const LAPTOP = MachineId.make('laptop')
export const TERMINAL = TerminalId.make('term_1')

export const herdrLink = new HerdrLink({
  connection: HerdrConnectionId.make(1),
  lostAt: Option.none(),
})

export const agentRow = (fields: Partial<ConstructorParameters<typeof AgentRow>[0]> = {}) =>
  new AgentRow({
    pane: PaneId.make('w1:p1'),
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    terminal: TERMINAL,
    status: 'idle',
    title: 'EX-253 Example feature',
    label: Option.none(),
    createdByCrook: false,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq: 4,
    statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
    beforeHandoff: Option.none(),
    ask: Option.none(),
    runningSubagents: Option.none(),
    ...fields,
  })

export const machineStateWith = (agents: readonly AgentRow[]) =>
  new MachineState({
    machine: LAPTOP,
    version: MachineStateVersion.make(0),
    herdrVersion: '0.9.1',
    herdr: herdrLink,
    workspaces: [],
    tabs: [],
    panes: [],
    agents,
    places: [],
  })

export const AUDIT_EVERYTHING = new AuditPolicy({
  argumentLimit: DEFAULT_AUDIT_ARGUMENT_LIMIT,
  redactedArguments: [],
})

export const discardingAudit = Layer.succeed(AuditLog, AuditLog.of({ record: () => Effect.void }))

export const gitBranchesOnDisk = Layer.provide(GitBranches.layer, [BunFileSystem.layer, Path.layer])

export const executorWith = (
  herdr: Layer.Layer<HerdrClient>,
  state: SubscriptionRef.SubscriptionRef<MachineState>,
  options: ExecutorOptions = {},
) =>
  Layer.provideMerge(AgentDaemon.commandExecution, [
    MachineStateSync.layerTest(state, options.invalidate),
    CreatedPanes.layerTest(options.created),
    options.audit ?? discardingAudit,
    herdr,
    gitBranchesOnDisk,
    BunFileSystem.layer,
    Path.layer,
  ])

export const linkedAgentWith = (
  herdr: Layer.Layer<HerdrClient>,
  state: SubscriptionRef.SubscriptionRef<MachineState>,
  options: ExecutorOptions = {},
) =>
  Layer.provideMerge(
    Layer.mergeAll(AgentDaemon.commandExecution, AgentDaemon.transcriptStreamingAt([])),
    [
      MachineStateSync.layerTest(state, options.invalidate),
      CreatedPanes.layerTest(options.created),
      options.audit ?? discardingAudit,
      herdr,
      gitBranchesOnDisk,
      BunFileSystem.layer,
      Path.layer,
    ],
  )
