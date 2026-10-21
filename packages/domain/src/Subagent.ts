import * as Schema from 'effect/Schema'

import { SubagentId } from '@crook/domain/Ids'

export class Subagent extends Schema.Class<Subagent>('Subagent')({
  id: SubagentId,
  agentType: Schema.String,
  description: Schema.String,
  model: Schema.OptionFromNullOr(Schema.String),
  toolUseId: Schema.OptionFromNullOr(Schema.String),
  parent: Schema.OptionFromNullOr(SubagentId),
  spawnDepth: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  background: Schema.Boolean,
  finished: Schema.Boolean,
  stoppedByUser: Schema.Boolean,
}) {}
