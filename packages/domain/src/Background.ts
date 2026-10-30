import * as Schema from 'effect/Schema'

import { SubagentId } from '@crook/domain/Ids'
import { SubagentStatus } from '@crook/domain/Subagent'

const moment = Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)

const taskFields = {
  taskId: Schema.String,
  toolUseId: Schema.String,
  status: SubagentStatus,
  summary: Schema.OptionFromNullOr(Schema.String),
  stoppedByClaude: Schema.Boolean,
  startedAt: moment,
  endedAt: moment,
}

export class MonitorEvent extends Schema.Class<MonitorEvent>('MonitorEvent')({
  at: moment,
  text: Schema.String,
}) {}

export class ShellTask extends Schema.TaggedClass<ShellTask>()('ShellTask', {
  ...taskFields,
  command: Schema.OptionFromNullOr(Schema.String),
  description: Schema.OptionFromNullOr(Schema.String),
  checkedAt: Schema.Array(Schema.DateTimeUtcFromString),
  output: Schema.Array(Schema.String),
  lastOutputAt: moment,
  alive: Schema.OptionFromNullOr(Schema.Boolean),
}) {}

export class MonitorTask extends Schema.TaggedClass<MonitorTask>()('MonitorTask', {
  ...taskFields,
  description: Schema.String,
  command: Schema.OptionFromNullOr(Schema.String),
  expiresAt: moment,
  events: Schema.Array(MonitorEvent),
}) {}

export const BackgroundTask = Schema.Union([ShellTask, MonitorTask])
export type BackgroundTask = typeof BackgroundTask.Type

export class SubagentActivity extends Schema.Class<SubagentActivity>('SubagentActivity')({
  subagent: SubagentId,
  tool: Schema.OptionFromNullOr(Schema.String),
  subject: Schema.OptionFromNullOr(Schema.String),
  text: Schema.OptionFromNullOr(Schema.String),
  at: moment,
}) {}
