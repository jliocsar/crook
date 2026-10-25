import * as Schema from 'effect/Schema'

import { Subscription } from '@crook/herdr/Events'
import {
  AgentInfo,
  AgentStatus,
  PaneInfo,
  PaneProcessInfo,
  SessionSnapshot,
  TabInfo,
  WorkspaceInfo,
  WorktreeInfo,
} from '@crook/herdr/Records'

export interface HerdrMethod<Params, Result> {
  readonly name: string
  readonly params: Schema.Codec<Params, unknown>
  readonly result: Schema.Codec<Result, unknown>
}

const makeMethod = <Params, Result>(
  name: string,
  schemas: Omit<HerdrMethod<Params, Result>, 'name'>,
): HerdrMethod<Params, Result> => ({ name, ...schemas })

const EmptyParams = Schema.Struct({})

const PaneEnvironment = Schema.Record(Schema.String, Schema.String)

export const Ping = makeMethod('ping', {
  params: EmptyParams,
  result: Schema.Struct({
    type: Schema.Literal('pong'),
    version: Schema.String,
    protocol: Schema.Int,
  }),
})

export const AgentPromptMethod = makeMethod('agent.prompt', {
  params: Schema.Struct({
    target: Schema.String,
    text: Schema.String,
    wait: Schema.optionalKey(Schema.Struct({ until: Schema.Array(AgentStatus) })),
  }),
  result: Schema.Struct({ type: Schema.Literal('agent_prompted') }),
})

export const AgentSendKeysMethod = makeMethod('agent.send_keys', {
  params: Schema.Struct({ target: Schema.String, keys: Schema.Array(Schema.String) }),
  result: Schema.Struct({ type: Schema.Literal('ok') }),
})

export const PaneRenameMethod = makeMethod('pane.rename', {
  params: Schema.Struct({ pane_id: Schema.String, label: Schema.NullOr(Schema.String) }),
  result: Schema.Struct({ type: Schema.Literal('pane_info'), pane: PaneInfo }),
})

export const PaneCloseMethod = makeMethod('pane.close', {
  params: Schema.Struct({ pane_id: Schema.String }),
  result: Schema.Struct({ type: Schema.Literal('ok') }),
})

const PaneReadSource = Schema.Literals(['visible', 'recent', 'recent_unwrapped', 'detection'])

export const PaneReadMethod = makeMethod('pane.read', {
  params: Schema.Struct({ pane_id: Schema.String, source: PaneReadSource }),
  result: Schema.Struct({
    type: Schema.Literal('pane_read'),
    read: Schema.Struct({ pane_id: Schema.String, text: Schema.String, truncated: Schema.Boolean }),
  }),
})

const OutputMatch = Schema.Struct({
  type: Schema.Literals(['substring', 'regex']),
  value: Schema.String,
})

export const PaneWaitForOutputMethod = makeMethod('pane.wait_for_output', {
  params: Schema.Struct({
    pane_id: Schema.String,
    source: PaneReadSource,
    match: OutputMatch,
    timeout_ms: Schema.Int,
  }),
  result: Schema.Struct({ type: Schema.Literal('output_matched'), pane_id: Schema.String }),
})

export const TabCreateMethod = makeMethod('tab.create', {
  params: Schema.Struct({
    workspace_id: Schema.String,
    cwd: Schema.String,
    env: PaneEnvironment,
  }),
  result: Schema.Struct({
    type: Schema.Literal('tab_created'),
    tab: TabInfo,
    root_pane: PaneInfo,
  }),
})

export const WorkspaceCreateMethod = makeMethod('workspace.create', {
  params: Schema.Struct({ cwd: Schema.String, env: PaneEnvironment }),
  result: Schema.Struct({
    type: Schema.Literal('workspace_created'),
    workspace: WorkspaceInfo,
    tab: TabInfo,
    root_pane: PaneInfo,
  }),
})

export const PaneSendInputMethod = makeMethod('pane.send_input', {
  params: Schema.Struct({
    pane_id: Schema.String,
    text: Schema.String,
    keys: Schema.Array(Schema.String),
  }),
  result: Schema.Struct({ type: Schema.Literal('ok') }),
})

export const WorktreeCreateMethod = makeMethod('worktree.create', {
  params: Schema.Struct({ cwd: Schema.String, branch: Schema.String, path: Schema.String }),
  result: Schema.Struct({
    type: Schema.Literal('worktree_created'),
    workspace: WorkspaceInfo,
    tab: TabInfo,
    root_pane: PaneInfo,
    worktree: WorktreeInfo,
  }),
})

export const AgentStartMethod = makeMethod('agent.start', {
  params: Schema.Struct({ name: Schema.String, kind: Schema.String, pane_id: Schema.String }),
  result: Schema.Struct({
    type: Schema.Literal('agent_started'),
    agent: AgentInfo,
    argv: Schema.Array(Schema.String),
  }),
})

export const AgentWaitMethod = makeMethod('agent.wait', {
  params: Schema.Struct({
    target: Schema.String,
    until: Schema.Array(AgentStatus),
    timeout_ms: Schema.Int,
  }),
  result: Schema.Struct({ type: Schema.Literal('agent_info'), agent: AgentInfo }),
})

export const PaneProcessInfoMethod = makeMethod('pane.process_info', {
  params: Schema.Struct({ pane_id: Schema.String }),
  result: Schema.Struct({
    type: Schema.Literal('pane_process_info'),
    process_info: PaneProcessInfo,
  }),
})

export const SessionSnapshotMethod = makeMethod('session.snapshot', {
  params: EmptyParams,
  result: Schema.Struct({
    type: Schema.Literal('session_snapshot'),
    snapshot: SessionSnapshot,
  }),
})

export const EventsSubscribeMethod = makeMethod('events.subscribe', {
  params: Schema.Struct({ subscriptions: Schema.Array(Subscription) }),
  result: Schema.Struct({ type: Schema.Literal('subscription_started') }),
})
