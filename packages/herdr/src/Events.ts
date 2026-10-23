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

export const Subscription = Schema.Union([
  Schema.Struct({ type: LifecycleEventKind }),
  Schema.Struct({ type: Schema.Literal('pane.agent_status_changed'), pane_id: Schema.String }),
])
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

export const HerdrEvent = Schema.Union([
  lifecycleEvent('workspace_created', { workspace: WorkspaceInfo }),
  lifecycleEvent('workspace_updated', { workspace: WorkspaceInfo }),
  lifecycleEvent('workspace_metadata_updated', {
    workspace: WorkspaceInfo,
  }),
  lifecycleEvent('workspace_renamed', {
    ...workspaceRef,
    label: Schema.String,
  }),
  lifecycleEvent('workspace_moved', {
    ...workspaceRef,
    insert_index: Schema.Int,
    workspaces: Schema.Array(WorkspaceInfo),
  }),
  lifecycleEvent('workspace_reordered', {
    workspace_ids: Schema.Array(Schema.String),
    before_workspace_id: Schema.OptionFromOptionalNullOr(Schema.String),
    workspaces: Schema.Array(WorkspaceInfo),
  }),
  lifecycleEvent('workspace_closed', {
    ...workspaceRef,
    workspace: Schema.OptionFromOptionalNullOr(WorkspaceInfo),
  }),
  lifecycleEvent('workspace_focused', workspaceRef),
  lifecycleEvent('tab_created', { tab: TabInfo }),
  lifecycleEvent('tab_closed', tabRef),
  lifecycleEvent('tab_renamed', { ...tabRef, label: Schema.String }),
  lifecycleEvent('tab_moved', {
    ...tabRef,
    insert_index: Schema.Int,
    tabs: Schema.Array(TabInfo),
  }),
  lifecycleEvent('tab_focused', tabRef),
  lifecycleEvent('pane_created', { pane: PaneInfo }),
  lifecycleEvent('pane_closed', paneRef),
  lifecycleEvent('pane_updated', { pane: PaneInfo }),
  lifecycleEvent('pane_focused', paneRef),
  lifecycleEvent('pane_moved', {
    pane: PaneInfo,
    previous_pane_id: Schema.String,
    previous_tab_id: Schema.String,
    previous_workspace_id: Schema.String,
    closed_tab_id: Schema.OptionFromOptionalNullOr(Schema.String),
    closed_workspace_id: Schema.OptionFromOptionalNullOr(Schema.String),
    created_tab: Schema.OptionFromOptionalNullOr(TabInfo),
    created_workspace: Schema.OptionFromOptionalNullOr(WorkspaceInfo),
  }),
  lifecycleEvent('pane_exited', paneRef),
  lifecycleEvent('pane_agent_detected', {
    ...paneRef,
    agent: Schema.OptionFromOptionalNullOr(Schema.String),
    final_status: Schema.OptionFromOptionalNullOr(AgentStatus),
    released: Schema.OptionFromOptional(Schema.Boolean),
  }),
  Schema.Struct({
    event: Schema.Literal('pane.agent_status_changed'),
    data: Schema.Struct({
      ...paneRef,
      agent_status: AgentStatus,
      agent: Schema.OptionFromOptionalNullOr(Schema.String),
      display_agent: Schema.OptionFromOptionalNullOr(Schema.String),
      title: Schema.OptionFromOptionalNullOr(Schema.String),
    }),
  }),
])
export type HerdrEvent = typeof HerdrEvent.Type
