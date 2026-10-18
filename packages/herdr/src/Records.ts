import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

export const AgentStatus = Schema.Literals(['idle', 'working', 'blocked', 'done', 'unknown'])
export type AgentStatus = typeof AgentStatus.Type

export const AgentSessionRefKind = Schema.Literals(['id', 'path'])
export type AgentSessionRefKind = typeof AgentSessionRefKind.Type

export class AgentSessionInfo extends Schema.Class<AgentSessionInfo>('AgentSessionInfo')({
  agent: Schema.String,
  kind: AgentSessionRefKind,
  source: Schema.String,
  value: Schema.String,
}) {}

export class WorkspaceInfo extends Schema.Class<WorkspaceInfo>('WorkspaceInfo')({
  workspace_id: Schema.String,
  number: Schema.Int,
  label: Schema.String,
  focused: Schema.Boolean,
  pane_count: Schema.Int,
  tab_count: Schema.Int,
  active_tab_id: Schema.String,
  agent_status: AgentStatus,
}) {}

export class TabInfo extends Schema.Class<TabInfo>('TabInfo')({
  tab_id: Schema.String,
  workspace_id: Schema.String,
  number: Schema.Int,
  label: Schema.String,
  focused: Schema.Boolean,
  pane_count: Schema.Int,
  agent_status: AgentStatus,
}) {}

export class PaneInfo extends Schema.Class<PaneInfo>('PaneInfo')({
  pane_id: Schema.String,
  terminal_id: Schema.String,
  workspace_id: Schema.String,
  tab_id: Schema.String,
  focused: Schema.Boolean,
  revision: Schema.Int,
  agent_status: AgentStatus,
  agent: Schema.OptionFromOptionalNullOr(Schema.String),
  display_agent: Schema.OptionFromOptionalNullOr(Schema.String),
  agent_session: Schema.OptionFromOptionalNullOr(AgentSessionInfo),
  label: Schema.OptionFromOptionalNullOr(Schema.String),
  title: Schema.OptionFromOptionalNullOr(Schema.String),
  terminal_title: Schema.OptionFromOptionalNullOr(Schema.String),
  cwd: Schema.OptionFromOptionalNullOr(Schema.String),
  foreground_cwd: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}

export class AgentInfo extends Schema.Class<AgentInfo>('AgentInfo')({
  pane_id: Schema.String,
  terminal_id: Schema.String,
  workspace_id: Schema.String,
  tab_id: Schema.String,
  focused: Schema.Boolean,
  revision: Schema.Int,
  agent_status: AgentStatus,
  state_change_seq: Schema.Int.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
  completion_seq: Schema.OptionFromOptionalNullOr(Schema.Int),
  name: Schema.OptionFromOptionalNullOr(Schema.String),
  agent: Schema.OptionFromOptionalNullOr(Schema.String),
  display_agent: Schema.OptionFromOptionalNullOr(Schema.String),
  agent_session: Schema.OptionFromOptionalNullOr(AgentSessionInfo),
  title: Schema.OptionFromOptionalNullOr(Schema.String),
  terminal_title: Schema.OptionFromOptionalNullOr(Schema.String),
  terminal_title_stripped: Schema.OptionFromOptionalNullOr(Schema.String),
  cwd: Schema.OptionFromOptionalNullOr(Schema.String),
  foreground_cwd: Schema.OptionFromOptionalNullOr(Schema.String),
}) {}

export class PaneProcess extends Schema.Class<PaneProcess>('PaneProcess')({
  pid: Schema.Int,
  name: Schema.String,
}) {}

export class PaneProcessInfo extends Schema.Class<PaneProcessInfo>('PaneProcessInfo')({
  pane_id: Schema.String,
  foreground_processes: Schema.Array(PaneProcess),
}) {}

export class SessionSnapshot extends Schema.Class<SessionSnapshot>('SessionSnapshot')({
  version: Schema.String,
  protocol: Schema.Int,
  focused_workspace_id: Schema.OptionFromOptionalNullOr(Schema.String),
  focused_tab_id: Schema.OptionFromOptionalNullOr(Schema.String),
  focused_pane_id: Schema.OptionFromOptionalNullOr(Schema.String),
  workspaces: Schema.Array(WorkspaceInfo),
  tabs: Schema.Array(TabInfo),
  panes: Schema.Array(PaneInfo),
  agents: Schema.Array(AgentInfo),
}) {}
