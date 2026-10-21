import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Str from 'effect/String'

import { AskId } from '@crook/domain/Ids'
import { PatchHunk } from '@crook/domain/TranscriptMessage'

const PATH_SEPARATOR = '/'

export const AskSource = Schema.Literals(['hook', 'transcript', 'screen'])
export type AskSource = typeof AskSource.Type

export const AskChoice = Schema.Literals(['yes', 'always', 'no', 'other'])
export type AskChoice = typeof AskChoice.Type

export class AskOption extends Schema.Class<AskOption>('AskOption')({
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  label: Schema.String,
  choice: AskChoice,
}) {}

export class RunCommand extends Schema.TaggedClass<RunCommand>()('RunCommand', {
  command: Schema.String,
}) {}

export class EditFile extends Schema.TaggedClass<EditFile>()('EditFile', {
  filePath: Schema.String,
  oldString: Schema.String,
  newString: Schema.String,
  replaceAll: Schema.Boolean,
  patch: Schema.OptionFromNullOr(Schema.Array(PatchHunk)),
}) {}

export class WriteFile extends Schema.TaggedClass<WriteFile>()('WriteFile', {
  filePath: Schema.String,
  content: Schema.String,
}) {}

export class UseTool extends Schema.TaggedClass<UseTool>()('UseTool', {
  input: Schema.Json,
}) {}

export class ScreenDetail extends Schema.TaggedClass<ScreenDetail>()('ScreenDetail', {
  subject: Schema.OptionFromNullOr(Schema.String),
  text: Schema.String,
}) {}

export const AskedAction = Schema.Union([RunCommand, EditFile, WriteFile, UseTool, ScreenDetail])
export type AskedAction = typeof AskedAction.Type

export class PermissionAsk extends Schema.TaggedClass<PermissionAsk>()('PermissionAsk', {
  id: AskId,
  source: AskSource,
  tool: Schema.String,
  plugin: Schema.OptionFromNullOr(Schema.String),
  action: AskedAction,
  options: Schema.Array(AskOption),
}) {}

export class QuestionChoice extends Schema.Class<QuestionChoice>('QuestionChoice')({
  label: Schema.String,
  description: Schema.OptionFromNullOr(Schema.String),
}) {}

export class AskQuestion extends Schema.Class<AskQuestion>('AskQuestion')({
  header: Schema.String,
  question: Schema.String,
  multiSelect: Schema.OptionFromNullOr(Schema.Boolean),
  choices: Schema.Array(QuestionChoice),
}) {}

export class QuestionAsk extends Schema.TaggedClass<QuestionAsk>()('QuestionAsk', {
  id: AskId,
  source: AskSource,
  questions: Schema.NonEmptyArray(AskQuestion),
}) {}

export class UnknownAsk extends Schema.TaggedClass<UnknownAsk>()('UnknownAsk', {
  id: AskId,
  screen: Schema.String,
}) {}

export const Ask = Schema.Union([PermissionAsk, QuestionAsk, UnknownAsk])
export type Ask = typeof Ask.Type

const firstLine = (text: string) =>
  pipe(Str.split(text.trim(), '\n'), Arr.headNonEmpty, (line) => line.trim())

export const relativeToFolder = (folder: string, filePath: string): string =>
  pipe(
    Option.liftPredicate(`${folder}${PATH_SEPARATOR}`, () => folder.length > 0),
    Option.filter((prefix) => filePath.startsWith(prefix)),
    Option.match({
      onNone: () => filePath,
      onSome: (prefix) => filePath.slice(prefix.length),
    }),
  )

const actionSummary = (tool: string, action: AskedAction, folder: string): string =>
  Match.value(action).pipe(
    Match.tagsExhaustive({
      RunCommand: (run) => `${tool} ${firstLine(run.command)}`,
      EditFile: (edit) => `${tool} ${relativeToFolder(folder, edit.filePath)}`,
      WriteFile: (write) => `${tool} ${relativeToFolder(folder, write.filePath)}`,
      UseTool: () => tool,
      ScreenDetail: (detail) =>
        Option.match(detail.subject, {
          onNone: () => tool,
          onSome: (subject) => `${tool} ${subject}`,
        }),
    }),
  )

export const askSummary = (ask: Ask, folder: string): Option.Option<string> =>
  Match.value(ask).pipe(
    Match.tagsExhaustive({
      PermissionAsk: (permission) =>
        Option.some(actionSummary(permission.tool, permission.action, folder)),
      QuestionAsk: (question) => Option.some(Arr.headNonEmpty(question.questions).question),
      UnknownAsk: () => Option.none(),
    }),
  )

export const askOption = (ask: PermissionAsk, choice: AskChoice): Option.Option<AskOption> =>
  Arr.findFirst(ask.options, (option) => option.choice === choice)
