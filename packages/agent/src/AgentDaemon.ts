import * as Layer from 'effect/Layer'

import { AuditLog } from '@crook/agent/AuditLog'
import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { CommandExecutor } from '@crook/agent/CommandExecutor'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import * as HubLink from '@crook/agent/HubLink'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { PendingAsks } from '@crook/agent/PendingAsks'
import { RecentPlaces } from '@crook/agent/RecentPlaces'
import { TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { HerdrClient } from '@crook/herdr/HerdrClient'

const machineFacts = Layer.provideMerge(
  Layer.mergeAll(ClaudeSessions.layer, PendingAsks.layer, RecentPlaces.layer),
  Layer.mergeAll(HerdrClient.layer, GitBranches.layer, CreatedPanes.layer, AuditLog.layer),
)

const machineServices = Layer.provideMerge(
  Layer.mergeAll(CommandExecutor.layer, TranscriptStreams.layer),
  Layer.provideMerge(MachineStateSync.layer, machineFacts),
)

export const layer = Layer.provide(HubLink.layer, machineServices)
