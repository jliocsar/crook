import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { CODE_MODE_TOOL } from '@crook/domain/ToolName'
import type { ToolResultBlock } from '@crook/domain/TranscriptMessage'
import { textsIn } from '@crook/web/chat/Blocks'
import { LINE_BREAK } from '@crook/web/text/Lines'

export type ToolResultView = Data.TaggedEnum<{
  Structured: { readonly text: string }
  Words: { readonly text: string }
}>

export interface ToolField {
  readonly key: string
  readonly label: string
  readonly text: string
  readonly language: Option.Option<string>
}

interface FailableCall {
  readonly name: string
  readonly input: Schema.Json
  readonly result: Option.Option<ToolResultBlock>
}

const SEND_MESSAGE_TOOL = 'SendMessage'
const EXECUTOR_PREFIX = 'mcp__executor__'
const RUN_FAILED_PREFIX = 'run failed: '
const APPROVAL_STATUS = 'approval-required'
const INPUTS_FIELD = 'inputs'
const JSON_LANGUAGE = 'json'
const JSON_INDENT = 2
const STRUCTURED_OPENERS: readonly string[] = ['{', '[']

const CODE_LANGUAGE = new Map([
  [`${CODE_MODE_TOOL} code`, 'typescript'],
  ['mcp__executor__execute code', 'javascript'],
  ['Workflow script', 'javascript'],
  ['Monitor command', 'shellscript'],
])

const InputFields = Schema.Record(Schema.String, Schema.Json)

const ApprovalRequest = Schema.fromJsonString(
  Schema.Struct({
    status: Schema.Literal(APPROVAL_STATUS),
    elicitation: Schema.Struct({ message: Schema.NonEmptyString }),
  }),
)

const SentMessage = Schema.fromJsonString(Schema.Struct({ message: Schema.NonEmptyString }))
const JsonText = Schema.fromJsonString(Schema.Json)

const decodeFields = Schema.decodeUnknownOption(InputFields)
const decodeApproval = Schema.decodeUnknownOption(ApprovalRequest)
const decodeSentMessage = Schema.decodeUnknownOption(SentMessage)
const decodeJson = Schema.decodeUnknownOption(JsonText)

export const ToolResultView = Data.taggedEnum<ToolResultView>()

const textOf = (result: ToolResultBlock): string => Arr.join(textsIn(result.content), LINE_BREAK)

const spokenField = (field: string): string =>
  field
    .replaceAll(/_+/gu, ' ')
    .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, '$<lower> $<upper>')
    .toLowerCase()

const structuredText = (value: Schema.Json): string => JSON.stringify(value, null, JSON_INDENT)

const isStructured = (text: string): boolean =>
  STRUCTURED_OPENERS.some((opener) => text.trimStart().startsWith(opener))

const nonStringField = (key: string, label: string, text: string): ToolField => ({
  key,
  label,
  text,
  language: Option.liftPredicate(JSON_LANGUAGE, () => isStructured(text)),
})

const fieldOf = (tool: string, key: string, label: string, value: Schema.Json): ToolField =>
  Predicate.isString(value)
    ? {
        key,
        label,
        text: value,
        language: Option.fromUndefinedOr(CODE_LANGUAGE.get(`${tool} ${key}`)),
      }
    : nonStringField(key, label, structuredText(value))

const codeModeInputs = (value: Schema.Json): Option.Option<readonly ToolField[]> =>
  Option.map(decodeFields(value), (inputs) =>
    Arr.map(Object.entries(inputs), ([name, entry]) =>
      fieldOf(CODE_MODE_TOOL, `${INPUTS_FIELD}.${name}`, `${INPUTS_FIELD}.${name}`, entry),
    ),
  )

const fieldsOfEntry = (tool: string, key: string, value: Schema.Json): readonly ToolField[] =>
  tool === CODE_MODE_TOOL && key === INPUTS_FIELD
    ? Option.getOrElse(codeModeInputs(value), () => [fieldOf(tool, key, spokenField(key), value)])
    : [fieldOf(tool, key, spokenField(key), value)]

export const toolFields = (tool: string, input: Schema.Json): readonly ToolField[] =>
  pipe(
    decodeFields(input),
    Option.match({
      onNone: () => [],
      onSome: (fields) =>
        Arr.flatMap(Object.entries(fields), ([key, value]) => fieldsOfEntry(tool, key, value)),
    }),
  )

export const approvalMessage = (
  call: Pick<FailableCall, 'name' | 'result'>,
): Option.Option<string> =>
  pipe(
    call.result,
    Option.filter(() => call.name.startsWith(EXECUTOR_PREFIX)),
    Option.map(textOf),
    Option.filter(Str.includes(APPROVAL_STATUS)),
    Option.flatMap(decodeApproval),
    Option.map(({ elicitation }) => elicitation.message),
  )

const resultFailed = (tool: string, result: ToolResultBlock): boolean =>
  result.isError ||
  (tool === CODE_MODE_TOOL &&
    Option.exists(Arr.head(textsIn(result.content)), Str.startsWith(RUN_FAILED_PREFIX)))

export const resultStatus = (
  tool: string,
  result: ToolResultBlock,
): 'success' | 'error' | 'stopped' => {
  if (resultFailed(tool, result)) {
    return 'error'
  }

  return Option.isSome(approvalMessage({ name: tool, result: Option.some(result) }))
    ? 'stopped'
    : 'success'
}

const wordsOrStructured = (call: FailableCall, text: string): ToolResultView =>
  pipe(
    Option.liftPredicate(text, () => call.name === SEND_MESSAGE_TOOL),
    Option.flatMap(decodeSentMessage),
    Option.map(({ message }) => ToolResultView.Words({ text: message })),
    Option.orElse(() =>
      pipe(
        Option.liftPredicate(text, isStructured),
        Option.flatMap(decodeJson),
        Option.map((value) => ToolResultView.Structured({ text: structuredText(value) })),
      ),
    ),
    Option.getOrElse(() => ToolResultView.Words({ text })),
  )

export const toolResultView = (call: FailableCall): Option.Option<ToolResultView> =>
  pipe(
    call.result,
    Option.filter(() => Option.isNone(approvalMessage(call))),
    Option.map(textOf),
    Option.filter((text) => text.trim() !== ''),
    Option.map((text) => wordsOrStructured(call, text)),
  )
