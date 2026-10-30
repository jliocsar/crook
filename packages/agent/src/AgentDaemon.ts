import * as Layer from 'effect/Layer'

import * as StatusSocket from '@crook/agent/StatusSocket'
import { AuditLog } from '@crook/agent/AuditLog'
import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { CommandExecutor } from '@crook/agent/CommandExecutor'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { HubConnectionStatus } from '@crook/agent/HubConnection'
import * as HubLink from '@crook/agent/HubLink'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { PendingAsks } from '@crook/agent/PendingAsks'
import { RecentPlaces } from '@crook/agent/RecentPlaces'
import { RunningSubagents } from '@crook/agent/RunningSubagents'
import { TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { HerdrClient } from '@crook/herdr/HerdrClient'

const machineFacts = Layer.provideMerge(
  Layer.mergeAll(
    ClaudeSessions.layer,
    PendingAsks.layer,
    RecentPlaces.layer,
    RunningSubagents.layer,
  ),
  Layer.mergeAll(HerdrClient.layer, GitBranches.layer, CreatedPanes.layer, AuditLog.layer),
)

const machineServices = Layer.provideMerge(
  Layer.mergeAll(CommandExecutor.layer, TranscriptStreams.layer),
  Layer.provideMerge(MachineStateSync.layer, machineFacts),
)

const hubLink = Layer.provide(HubLink.layer, machineServices)

export const layer = Layer.provide(
  Layer.mergeAll(StatusSocket.layer, hubLink),
  HubConnectionStatus.layer,
)
