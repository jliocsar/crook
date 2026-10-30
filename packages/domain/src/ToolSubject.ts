import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

const LINE_BREAK = '\n'

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
])

const InputFields = Schema.Record(Schema.String, Schema.Unknown)

const decodeFields = Schema.decodeUnknownOption(InputFields)
const decodeString = Schema.decodeUnknownOption(Schema.NonEmptyString)

export const PATH_FIELDS = new Set(['file_path', 'notebook_path', 'path'])

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

export const subjectEntry = (
  name: string,
  input: Schema.Json,
): Option.Option<readonly [string, string]> =>
  pipe(
    Option.fromUndefinedOr(SUBJECT_FIELD.get(name)),
    Option.flatMap((field) =>
      Option.map(stringField(input, field), (value): readonly [string, string] => [field, value]),
    ),
    Option.orElse(() => firstStringField(input)),
  )

export const toolSubject = (name: string, input: Schema.Json): Option.Option<string> =>
  pipe(
    subjectEntry(name, input),
    Option.map(([field, value]) => (PATH_FIELDS.has(field) ? value : firstLine(value))),
    Option.filter(Str.isNonEmpty),
  )
