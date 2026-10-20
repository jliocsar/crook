import * as Schema from 'effect/Schema'

import { AgentStatus } from '@crook/domain/AgentStatus'
import { ClaudeSessionId, PaneId, TabId, WorkspaceId } from '@crook/domain/Ids'

export class AgentRow extends Schema.Class<AgentRow>('AgentRow')({
  pane: PaneId,
  workspace: WorkspaceId,
  tab: TabId,
  status: AgentStatus,
  title: Schema.String,
  cwd: Schema.String,
  branch: Schema.OptionFromNullOr(Schema.String),
  claudeSession: Schema.OptionFromNullOr(ClaudeSessionId),
  stateChangeSeq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  statusChangedAt: Schema.DateTimeUtcFromString,
}) {}
