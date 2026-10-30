import * as Match from 'effect/Match'
import * as Schema from 'effect/Schema'

import { SubagentId } from '@crook/domain/Ids'

export const SubagentStatus = Schema.Literals(['running', 'completed', 'failed', 'stopped'])
export type SubagentStatus = typeof SubagentStatus.Type

export const statusOfNotice = (status: string): SubagentStatus =>
  Match.value(status).pipe(
    Match.when('completed', (): SubagentStatus => 'completed'),
    Match.whenOr('killed', 'stopped', (): SubagentStatus => 'stopped'),
    Match.orElse((): SubagentStatus => 'failed'),
  )

export class Subagent extends Schema.Class<Subagent>('Subagent')({
  id: SubagentId,
  agentType: Schema.String,
  description: Schema.String,
  model: Schema.OptionFromNullOr(Schema.String),
  toolUseId: Schema.OptionFromNullOr(Schema.String),
  parent: Schema.OptionFromNullOr(SubagentId),
  spawnDepth: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  background: Schema.Boolean,
  status: SubagentStatus,
}) {}
