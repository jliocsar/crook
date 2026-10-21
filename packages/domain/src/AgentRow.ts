import * as Schema from 'effect/Schema'

import { AgentStatus } from '@crook/domain/AgentStatus'
import { ClaudeSessionId, PaneId, TabId, TerminalId, WorkspaceId } from '@crook/domain/Ids'

export class StatusBeforeHandoff extends Schema.Class<StatusBeforeHandoff>('StatusBeforeHandoff')({
  status: AgentStatus,
  statusChangedAt: Schema.DateTimeUtcFromString,
}) {}

export class AgentRow extends Schema.Class<AgentRow>('AgentRow')({
  pane: PaneId,
  workspace: WorkspaceId,
  tab: TabId,
  terminal: TerminalId,
  status: AgentStatus,
  title: Schema.String,
  cwd: Schema.String,
  branch: Schema.OptionFromNullOr(Schema.String),
  claudeSession: Schema.OptionFromNullOr(ClaudeSessionId),
  stateChangeSeq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  statusChangedAt: Schema.DateTimeUtcFromString,
  beforeHandoff: Schema.OptionFromNullOr(StatusBeforeHandoff),
}) {}
