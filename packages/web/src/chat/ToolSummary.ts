import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { relativeToFolder } from '@crook/domain/Ask'
import { LINE_BREAK } from '@crook/web/text/Lines'

export type PlanStep = typeof PlanStep.Type

const PATH_FIELDS = new Set(['file_path', 'notebook_path', 'path'])

const SUMMARY_FIELD = new Map([
  ['Bash', 'command'],
  ['Read', 'file_path'],
  ['Edit', 'file_path'],
  ['MultiEdit', 'file_path'],
  ['Write', 'file_path'],
  ['NotebookEdit', 'notebook_path'],
  ['Grep', 'pattern'],
  ['Glob', 'pattern'],
  ['WebFetch', 'url'],
  ['WebSearch', 'query'],
  ['Agent', 'description'],
  ['Skill', 'skill'],
  ['ToolSearch', 'query'],
])

const InputFields = Schema.Record(Schema.String, Schema.Unknown)

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

const decodeFields = Schema.decodeUnknownOption(InputFields)
const decodeString = Schema.decodeUnknownOption(Schema.NonEmptyString)

export const decodePlan = Schema.decodeUnknownOption(PlanInput)
export const decodeAgentInput = Schema.decodeUnknownOption(AgentInput)

const firstLine = (text: string): string =>
  pipe(
    text.trim().split(LINE_BREAK),
    Arr.head,
    Option.getOrElse(() => ''),
  )

export const stringField = (input: Schema.Json, field: string): Option.Option<string> =>
  pipe(
    decodeFields(input),
    Option.flatMap((fields) => decodeString(fields[field])),
  )

const firstStringField = (input: Schema.Json): Option.Option<readonly [string, string]> =>
  pipe(
    decodeFields(input),
    Option.flatMap((fields) =>
      Arr.findFirst(Object.entries(fields), ([field, value]) =>
        Option.map(decodeString(value), (text): readonly [string, string] => [field, text]),
      ),
    ),
  )

const summaryEntry = (name: string, input: Schema.Json): Option.Option<readonly [string, string]> =>
  pipe(
    Option.fromUndefinedOr(SUMMARY_FIELD.get(name)),
    Option.flatMap((field) =>
      Option.map(stringField(input, field), (value): readonly [string, string] => [field, value]),
    ),
    Option.orElse(() => firstStringField(input)),
  )

export const toolSummary = (name: string, input: Schema.Json, cwd: string): Option.Option<string> =>
  pipe(
    summaryEntry(name, input),
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
    onNone: () => call.name,
    onSome: (summary) => `${call.name}(${summary})`,
  })
