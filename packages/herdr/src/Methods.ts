import * as Schema from 'effect/Schema'

import { PaneInfo, PaneProcessInfo, SessionSnapshot } from '@crook/herdr/Records'

export interface HerdrMethod<Params, Result> {
  readonly name: string
  readonly params: Schema.Codec<Params, unknown>
  readonly result: Schema.Codec<Result, unknown>
}

export const makeMethod = <Params, Result>(
  name: string,
  schemas: Omit<HerdrMethod<Params, Result>, 'name'>,
): HerdrMethod<Params, Result> => ({ name, ...schemas })

export const EmptyParams = Schema.Struct({})

export const Ping = makeMethod('ping', {
  params: EmptyParams,
  result: Schema.Struct({
    type: Schema.Literal('pong'),
    version: Schema.String,
    protocol: Schema.Int,
  }),
})

export const AgentPromptMethod = makeMethod('agent.prompt', {
  params: Schema.Struct({ target: Schema.String, text: Schema.String }),
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

export const PaneReadSource = Schema.Literals([
  'visible',
  'recent',
  'recent_unwrapped',
  'detection',
])
export type PaneReadSource = typeof PaneReadSource.Type

export const PaneReadMethod = makeMethod('pane.read', {
  params: Schema.Struct({ pane_id: Schema.String, source: PaneReadSource }),
  result: Schema.Struct({
    type: Schema.Literal('pane_read'),
    read: Schema.Struct({ pane_id: Schema.String, text: Schema.String, truncated: Schema.Boolean }),
  }),
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
