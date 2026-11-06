import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { CODE_MODE_TOOL, toolName } from '@crook/domain/ToolName'

const LINE_BREAK = '\n'
const CODE_FIELD = 'code'
const TOOL_NAME_SEPARATOR = ', '
const TOOL_CALL = /tools\.call\(\s*['"`](?<tool>[^'"`]+)['"`]/gu

const SUBJECT_FIELD = new Map([
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
  ['Monitor', 'description'],
  ['SendMessage', 'to'],
  ['Workflow', 'scriptPath'],
  ['mcp__executor__resume', 'action'],
])

const InputFields = Schema.Record(Schema.String, Schema.Unknown)

const decodeFields = Schema.decodeUnknownOption(InputFields)
const decodeString = Schema.decodeUnknownOption(Schema.NonEmptyString)

export const PATH_FIELDS = new Set(['file_path', 'notebook_path', 'path', 'scriptPath'])

export const firstLine = (text: string): string =>
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

const toolsCalled = (code: string): string =>
  pipe(
    Array.from(code.matchAll(TOOL_CALL)),
    Arr.flatMap((call) => Option.toArray(Option.fromUndefinedOr(call.groups?.['tool']))),
    Arr.dedupe,
    Arr.map(toolName),
    Arr.join(TOOL_NAME_SEPARATOR),
  )

const codeModeEntry = (input: Schema.Json): Option.Option<readonly [string, string]> =>
  pipe(
    stringField(input, CODE_FIELD),
    Option.map(toolsCalled),
    Option.filter(Str.isNonEmpty),
    Option.map((tools): readonly [string, string] => [CODE_FIELD, tools]),
  )

export const subjectEntry = (
  name: string,
  input: Schema.Json,
): Option.Option<readonly [string, string]> =>
  pipe(
    Option.liftPredicate(input, () => name === CODE_MODE_TOOL),
    Option.flatMap(codeModeEntry),
    Option.orElse(() =>
      pipe(
        Option.fromUndefinedOr(SUBJECT_FIELD.get(name)),
        Option.flatMap((field) =>
          Option.map(stringField(input, field), (value): readonly [string, string] => [
            field,
            value,
          ]),
        ),
      ),
    ),
    Option.orElse(() => firstStringField(input)),
  )

export const toolSubject = (name: string, input: Schema.Json): Option.Option<string> =>
  pipe(
    subjectEntry(name, input),
    Option.map(([field, value]) => (PATH_FIELDS.has(field) ? value : firstLine(value))),
    Option.filter(Str.isNonEmpty),
  )
