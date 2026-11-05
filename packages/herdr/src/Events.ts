import * as Schema from 'effect/Schema'

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

export const HerdrEvent = Schema.Struct({
  event: Schema.String,
  data: Schema.optionalKey(Schema.Unknown),
})
export type HerdrEvent = typeof HerdrEvent.Type
