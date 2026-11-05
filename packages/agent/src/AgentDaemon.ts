import * as Effect from 'effect/Effect'
import type * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import type * as Path from 'effect/Path'

import * as StatusSocket from '@crook/agent/StatusSocket'
import { AgentLauncher } from '@crook/agent/AgentLauncher'
import { AskAnswers } from '@crook/agent/AskAnswers'
import { AuditLog } from '@crook/agent/AuditLog'
import { CheckoutHeads } from '@crook/agent/CheckoutHeads'
import { ClaudeSessionFiles } from '@crook/agent/ClaudeSessionFiles'
import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { CommandExecutor } from '@crook/agent/CommandExecutor'
import { CommandPolicy } from '@crook/agent/CommandPolicy'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { HookInbox } from '@crook/agent/HookInbox'
import { HubConnectionStatus } from '@crook/agent/HubConnection'
import * as HubLink from '@crook/agent/HubLink'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { PaneScreens } from '@crook/agent/PaneScreens'
import { PendingAsks } from '@crook/agent/PendingAsks'
import { RecentPlaces } from '@crook/agent/RecentPlaces'
import { RunningSubagents } from '@crook/agent/RunningSubagents'
import { TaskLiveness } from '@crook/agent/TaskLiveness'
import { TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { BackgroundWork } from '@crook/claude/BackgroundWork'
import { claudeRoots } from '@crook/claude/ClaudeRoots'
import { FileWatch } from '@crook/claude/FileWatch'
import { LastTurn } from '@crook/claude/LastTurn'
import { MANAGED_SKILL_HOMES, SkillCatalog } from '@crook/claude/SkillCatalog'
import { SubagentRoster } from '@crook/claude/SubagentRoster'
import { TranscriptLocator } from '@crook/claude/TranscriptLocator'
import { TranscriptTail } from '@crook/claude/TranscriptTail'
import { HerdrClient } from '@crook/herdr/HerdrClient'

const watchedTranscriptsAt = (roots: readonly string[]) =>
  Layer.provideMerge(
    Layer.mergeAll(TranscriptTail.layer, TranscriptLocator.layerAt(roots)),
    FileWatch.layer,
  )

export const transcriptReadersAt = (roots: readonly string[]) =>
  Layer.provideMerge(SubagentRoster.layer, watchedTranscriptsAt(roots))

const transcriptStreamingWith = <SkillsFailure>(
  skills: Layer.Layer<SkillCatalog, SkillsFailure, FileSystem.FileSystem | Path.Path>,
) =>
  Layer.provide(
    TranscriptStreams.layer,
    Layer.mergeAll(BackgroundWork.layer, skills, TaskLiveness.layer),
  )

export const transcriptStreamingAt = (roots: readonly string[]) =>
  Layer.provide(
    transcriptStreamingWith(SkillCatalog.layerAt(roots, MANAGED_SKILL_HOMES)),
    transcriptReadersAt(roots),
  )

const executorHelpers = Layer.provideMerge(
  Layer.mergeAll(CommandPolicy.layer, AskAnswers.layer, AgentLauncher.layer),
  PaneScreens.layer,
)

export const commandExecution = Layer.provide(CommandExecutor.layer, executorHelpers)

const transcriptReaders = Layer.unwrap(Effect.map(claudeRoots, transcriptReadersAt))

const machineHost = Layer.mergeAll(
  HerdrClient.layer,
  GitBranches.layer,
  CreatedPanes.layer,
  AuditLog.layer,
)

const machineReaders = Layer.provideMerge(
  Layer.mergeAll(PaneScreens.layer, HookInbox.layer, LastTurn.layer, transcriptReaders),
  machineHost,
)

const machineWatches = Layer.provideMerge(
  Layer.mergeAll(ClaudeSessionFiles.layer, CheckoutHeads.layer),
  machineReaders,
)

const machineFacts = Layer.provideMerge(
  Layer.mergeAll(
    ClaudeSessions.layer,
    PendingAsks.layer,
    RecentPlaces.layer,
    RunningSubagents.layer,
  ),
  machineWatches,
)

const machineState = Layer.provideMerge(MachineStateSync.layer, machineFacts)

const machineServices = Layer.provideMerge(
  Layer.mergeAll(commandExecution, transcriptStreamingWith(SkillCatalog.layer)),
  machineState,
)

const hubLink = Layer.provide(HubLink.layer, machineServices)

export const layer = Layer.provide(
  Layer.mergeAll(StatusSocket.layer, hubLink),
  HubConnectionStatus.layer,
)
