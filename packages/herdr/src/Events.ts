import * as Schema from 'effect/Schema'

import { AgentStatus, PaneInfo, TabInfo, WorkspaceInfo } from '@crook/herdr/Records'

export const LifecycleEventKind = Schema.Literals([
  'workspace.created',
  'workspace.updated',
  'workspace.metadata_updated',
  'workspace.renamed',
  'workspace.moved',
  'workspace.reordered',
  'workspace.closed',
  'workspace.focused',
  'tab.created',
  'tab.closed',
  'tab.renamed',
  'tab.moved',
  'tab.focused',
  'pane.created',
  'pane.closed',
  'pane.updated',
  'pane.focused',
  'pane.moved',
  'pane.exited',
  'pane.agent_detected',
])
export type LifecycleEventKind = typeof LifecycleEventKind.Type

export const LifecycleSubscription = Schema.Struct({ type: LifecycleEventKind })
export type LifecycleSubscription = typeof LifecycleSubscription.Type

export const AgentStatusSubscription = Schema.Struct({
  type: Schema.Literal('pane.agent_status_changed'),
  pane_id: Schema.String,
})
export type AgentStatusSubscription = typeof AgentStatusSubscription.Type

export const Subscription = Schema.Union([LifecycleSubscription, AgentStatusSubscription])
export type Subscription = typeof Subscription.Type

const lifecycleEvent = <Kind extends string, Fields extends Schema.Struct.Fields>(
  kind: Kind,
  fields: Fields,
) =>
  Schema.Struct({
    event: Schema.Literal(kind),
    data: Schema.Struct({ ...fields, type: Schema.Literal(kind) }),
  })

const workspaceRef = { workspace_id: Schema.String }

const tabRef = { tab_id: Schema.String, workspace_id: Schema.String }

const paneRef = { pane_id: Schema.String, workspace_id: Schema.String }

export const WorkspaceCreated = lifecycleEvent('workspace_created', { workspace: WorkspaceInfo })

export const WorkspaceUpdated = lifecycleEvent('workspace_updated', { workspace: WorkspaceInfo })

export const WorkspaceMetadataUpdated = lifecycleEvent('workspace_metadata_updated', {
  workspace: WorkspaceInfo,
})

export const WorkspaceRenamed = lifecycleEvent('workspace_renamed', {
  ...workspaceRef,
  label: Schema.String,
})

export const WorkspaceMoved = lifecycleEvent('workspace_moved', {
  ...workspaceRef,
  insert_index: Schema.Int,
  workspaces: Schema.Array(WorkspaceInfo),
})

export const WorkspaceReordered = lifecycleEvent('workspace_reordered', {
  workspace_ids: Schema.Array(Schema.String),
  before_workspace_id: Schema.OptionFromOptionalNullOr(Schema.String),
  workspaces: Schema.Array(WorkspaceInfo),
})

export const WorkspaceClosed = lifecycleEvent('workspace_closed', {
  ...workspaceRef,
  workspace: Schema.OptionFromOptionalNullOr(WorkspaceInfo),
})

export const WorkspaceFocused = lifecycleEvent('workspace_focused', workspaceRef)

export const TabCreated = lifecycleEvent('tab_created', { tab: TabInfo })

export const TabClosed = lifecycleEvent('tab_closed', tabRef)

export const TabRenamed = lifecycleEvent('tab_renamed', { ...tabRef, label: Schema.String })

export const TabMoved = lifecycleEvent('tab_moved', {
  ...tabRef,
  insert_index: Schema.Int,
  tabs: Schema.Array(TabInfo),
})

export const TabFocused = lifecycleEvent('tab_focused', tabRef)

export const PaneCreated = lifecycleEvent('pane_created', { pane: PaneInfo })

export const PaneClosed = lifecycleEvent('pane_closed', paneRef)

export const PaneUpdated = lifecycleEvent('pane_updated', { pane: PaneInfo })

export const PaneFocused = lifecycleEvent('pane_focused', paneRef)

export const PaneMoved = lifecycleEvent('pane_moved', {
  pane: PaneInfo,
  previous_pane_id: Schema.String,
  previous_tab_id: Schema.String,
  previous_workspace_id: Schema.String,
  closed_tab_id: Schema.OptionFromOptionalNullOr(Schema.String),
  closed_workspace_id: Schema.OptionFromOptionalNullOr(Schema.String),
  created_tab: Schema.OptionFromOptionalNullOr(TabInfo),
  created_workspace: Schema.OptionFromOptionalNullOr(WorkspaceInfo),
})

export const PaneExited = lifecycleEvent('pane_exited', paneRef)

export const PaneAgentDetected = lifecycleEvent('pane_agent_detected', {
  ...paneRef,
  agent: Schema.OptionFromOptionalNullOr(Schema.String),
  final_status: Schema.OptionFromOptionalNullOr(AgentStatus),
  released: Schema.OptionFromOptional(Schema.Boolean),
})

export const PaneAgentStatusChanged = Schema.Struct({
  event: Schema.Literal('pane.agent_status_changed'),
  data: Schema.Struct({
    ...paneRef,
    agent_status: AgentStatus,
    agent: Schema.OptionFromOptionalNullOr(Schema.String),
    display_agent: Schema.OptionFromOptionalNullOr(Schema.String),
    title: Schema.OptionFromOptionalNullOr(Schema.String),
  }),
})

export const HerdrEvent = Schema.Union([
  WorkspaceCreated,
  WorkspaceUpdated,
  WorkspaceMetadataUpdated,
  WorkspaceRenamed,
  WorkspaceMoved,
  WorkspaceReordered,
  WorkspaceClosed,
  WorkspaceFocused,
  TabCreated,
  TabClosed,
  TabRenamed,
  TabMoved,
  TabFocused,
  PaneCreated,
  PaneClosed,
  PaneUpdated,
  PaneFocused,
  PaneMoved,
  PaneExited,
  PaneAgentDetected,
  PaneAgentStatusChanged,
])
export type HerdrEvent = typeof HerdrEvent.Type
