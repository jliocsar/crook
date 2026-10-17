import * as Schema from 'effect/Schema'

import { SessionSnapshot } from '@crook/herdr/Records'

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

export const SessionSnapshotMethod = makeMethod('session.snapshot', {
  params: EmptyParams,
  result: Schema.Struct({
    type: Schema.Literal('session_snapshot'),
    snapshot: SessionSnapshot,
  }),
})
