import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { relativeToFolder } from '@crook/domain/Ask'
import { toolName } from '@crook/domain/ToolName'
import { firstLine, PATH_FIELDS, subjectEntry } from '@crook/domain/ToolSubject'

export type PlanStep = typeof PlanStep.Type

export const PlanStep = Schema.Struct({
  content: Schema.String,
  status: Schema.Literals(['pending', 'in_progress', 'completed']),
})

const PlanInput = Schema.Struct({ todos: Schema.Array(PlanStep) })

const AgentInput = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  prompt: Schema.optionalKey(Schema.String),
  subagent_type: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  run_in_background: Schema.optionalKey(Schema.Boolean),
})

export const decodePlan = Schema.decodeUnknownOption(PlanInput)
export const decodeAgentInput = Schema.decodeUnknownOption(AgentInput)

export const toolSummary = (name: string, input: Schema.Json, cwd: string): Option.Option<string> =>
  pipe(
    subjectEntry(name, input),
    Option.map(([field, value]) =>
      PATH_FIELDS.has(field) ? relativeToFolder(cwd, value) : firstLine(value),
    ),
    Option.filter(Str.isNonEmpty),
  )

export const toolTitle = (call: {
  readonly name: string
  readonly summary: Option.Option<string>
}): string =>
  Option.match(call.summary, {
    onNone: () => toolName(call.name),
    onSome: (summary) => `${toolName(call.name)}(${summary})`,
  })
