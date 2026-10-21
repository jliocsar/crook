import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { AgentStatus } from '@crook/domain/AgentStatus'
import { ClaudeSessionId, PaneId, TabId, TerminalId, WorkspaceId } from '@crook/domain/Ids'

export type SeenMark = Pick<AgentRow, 'terminal' | 'stateChangeSeq'>

export const StateChangeSeq = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export class StatusBeforeHandoff extends Schema.Class<StatusBeforeHandoff>('StatusBeforeHandoff')({
  status: AgentStatus,
  statusChangedAt: Schema.DateTimeUtcFromString,
  terminal: TerminalId,
  stateChangeSeq: StateChangeSeq,
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
  stateChangeSeq: StateChangeSeq,
  statusChangedAt: Schema.DateTimeUtcFromString,
  beforeHandoff: Schema.OptionFromNullOr(StatusBeforeHandoff),
}) {}

export const seenMarkOf = (row: AgentRow): SeenMark =>
  Option.match(row.beforeHandoff, {
    onNone: () => ({ terminal: row.terminal, stateChangeSeq: row.stateChangeSeq }),
    onSome: (before) => ({ terminal: before.terminal, stateChangeSeq: before.stateChangeSeq }),
  })
