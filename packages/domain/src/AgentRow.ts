import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { AgentStatus } from '@crook/domain/AgentStatus'
import { ClaudeSessionId, PaneId, TabId, WorkspaceId } from '@crook/domain/Ids'

export class AgentRow extends Schema.Class<AgentRow>('AgentRow')({
  pane: PaneId,
  workspace: WorkspaceId,
  tab: TabId,
  status: AgentStatus,
  title: Schema.String,
  label: Schema.OptionFromNullOr(Schema.String),
  createdByCrook: Schema.Boolean,
  cwd: Schema.String,
  branch: Schema.OptionFromNullOr(Schema.String),
  claudeSession: Schema.OptionFromNullOr(ClaudeSessionId),
  stateChangeSeq: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  statusChangedAt: Schema.DateTimeUtcFromString,
}) {}

export const agentTitle = (row: AgentRow): string => Option.getOrElse(row.label, () => row.title)
