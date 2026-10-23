import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Struct from 'effect/Struct'

import { editPatch } from '@crook/claude/EditPatch'
import type { PendingPermission } from '@crook/claude/HookLedger'
import { type DialogQueue, type ScreenDialog, dialogFingerprint } from '@crook/claude/ScreenDialog'
import {
  type Ask,
  type AskChoice,
  type AskSource,
  type AskedAction,
  AskOption,
  AskQuestion,
  EditFile,
  PermissionAsk,
  QuestionAsk,
  QuestionChoice,
  RunCommand,
  ScreenDetail,
  UnknownAsk,
  UseTool,
  WriteFile,
} from '@crook/domain/Ask'
import { AskId } from '@crook/domain/Ids'
import type { ToolUseBlock } from '@crook/domain/TranscriptMessage'

export interface BlockedEpisode {
  readonly terminal: string
  readonly stateChangeSeq: number
}

export interface AskEvidence {
  readonly episode: BlockedEpisode
  readonly screen: Option.Option<string>
  readonly dialog: Option.Option<ScreenDialog>
  readonly pending: readonly PendingPermission[]
  readonly toolUse: Option.Option<ToolUseBlock>
}

export interface PendingEdit {
  readonly permission: PermissionAsk
  readonly edit: EditFile
}

interface ToolCall {
  readonly source: AskSource
  readonly id: AskId
  readonly toolName: string
  readonly toolInput: Schema.Json
}

const YES_LABEL = 'Yes'
const NO_LABEL = 'No'
const ALWAYS_DESCRIPTION = 'always allow'
const OTHER_DESCRIPTION = 'other'
const LINE_BREAK = '\n'
const WRAPPED_LINE_JOIN = ' '
const PATH_SEPARATOR = '/'
const WHITESPACE = /\s+/gu
const QUESTION_TOOL = 'AskUserQuestion'

const ALWAYS_PREFIXES = [
  'Yes, and always allow',
  "Yes, and don't ask again",
  'Yes, and don’t ask again',
  'Yes, and allow ',
  'Yes, and remember this directory',
  'Yes, and keep allowing',
  'Yes, allow reading from',
  'Yes, and switch to accept edits',
]

const DIALOG_EXTRA_CHOICES = ['Type something.', 'Chat about this']

const HEADER_TOOLS = new Map([
  ['Bash command', 'Bash'],
  ['Edit file', 'Edit'],
  ['Create file', 'Write'],
])

const BashInput = Schema.Struct({ command: Schema.String })

const EditInput = Schema.Struct({
  file_path: Schema.String,
  old_string: Schema.String,
  new_string: Schema.String,
  replace_all: Schema.optionalKey(Schema.Boolean),
})

const WriteInput = Schema.Struct({ file_path: Schema.String, content: Schema.String })

const QuestionInput = Schema.Struct({
  questions: Schema.NonEmptyArray(
    Schema.Struct({
      question: Schema.String,
      header: Schema.String,
      multiSelect: Schema.optionalKey(Schema.Boolean),
      options: Schema.Array(
        Schema.Struct({ label: Schema.String, description: Schema.optionalKey(Schema.String) }),
      ),
    }),
  ),
})

const decodeInput = <Decoded>(schema: Schema.Decoder<Decoded>) => Schema.decodeUnknownOption(schema)

export const choiceLabel = (choice: AskChoice): string =>
  Match.value(choice).pipe(
    Match.when('yes', () => YES_LABEL),
    Match.when('always', () => ALWAYS_DESCRIPTION),
    Match.when('no', () => NO_LABEL),
    Match.when('other', () => OTHER_DESCRIPTION),
    Match.exhaustive,
  )

export const optionChoice = (label: string): AskChoice => {
  if (label === YES_LABEL) {
    return 'yes'
  }

  if (label === NO_LABEL) {
    return 'no'
  }

  return Arr.some(ALWAYS_PREFIXES, (prefix) => label.startsWith(prefix)) ? 'always' : 'other'
}

const askOptionsOf = (dialog: Option.Option<ScreenDialog>): readonly AskOption[] =>
  Option.match(dialog, {
    onNone: () => [],
    onSome: (found) =>
      found.kind === 'permission'
        ? found.options.map((option) => {
            const label = [option.label, ...option.details].join(WRAPPED_LINE_JOIN)

            return new AskOption({ number: option.number, label, choice: optionChoice(label) })
          })
        : [],
  })

const actionOf = (toolName: string, input: Schema.Json): AskedAction =>
  Match.value(toolName).pipe(
    Match.when('Bash', () =>
      Option.map(
        decodeInput(BashInput)(input),
        (bash): AskedAction => new RunCommand({ command: bash.command }),
      ),
    ),
    Match.when('Edit', () =>
      Option.map(
        decodeInput(EditInput)(input),
        (edit): AskedAction =>
          new EditFile({
            filePath: edit.file_path,
            oldString: edit.old_string,
            newString: edit.new_string,
            replaceAll: edit.replace_all ?? false,
            patch: Option.none(),
          }),
      ),
    ),
    Match.when('Write', () =>
      Option.map(
        decodeInput(WriteInput)(input),
        (write): AskedAction =>
          new WriteFile({ filePath: write.file_path, content: write.content }),
      ),
    ),
    Match.orElse(() => Option.none<AskedAction>()),
    Option.getOrElse((): AskedAction => new UseTool({ input })),
  )

const fingerprintOf = (dialog: Option.Option<ScreenDialog>) => Option.map(dialog, dialogFingerprint)

const questionAskOf = (call: ToolCall, dialog: Option.Option<ScreenDialog>): Option.Option<Ask> =>
  Option.map(
    decodeInput(QuestionInput)(call.toolInput),
    (input) =>
      new QuestionAsk({
        id: call.id,
        source: call.source,
        questions: Arr.map(
          input.questions,
          (question) =>
            new AskQuestion({
              header: question.header,
              question: question.question,
              multiSelect: Option.some(question.multiSelect ?? false),
              choices: question.options.map(
                (option) =>
                  new QuestionChoice({
                    label: option.label,
                    description: Option.fromUndefinedOr(option.description),
                  }),
              ),
            }),
        ),
        dialog: fingerprintOf(dialog),
      }),
  )

const permissionAskOf = (call: ToolCall, dialog: Option.Option<ScreenDialog>): Ask =>
  new PermissionAsk({
    id: call.id,
    source: call.source,
    tool: call.toolName,
    plugin: Option.flatMap(dialog, (found) => found.plugin),
    action: actionOf(call.toolName, call.toolInput),
    options: askOptionsOf(dialog),
    dialog: fingerprintOf(dialog),
  })

const askOfCall = (call: ToolCall, dialog: Option.Option<ScreenDialog>): Ask =>
  call.toolName === QUESTION_TOOL
    ? Option.getOrElse(questionAskOf(call, dialog), () => permissionAskOf(call, dialog))
    : permissionAskOf(call, dialog)

const toolOfHeader = (header: string): Option.Option<string> =>
  Option.fromUndefinedOr(HEADER_TOOLS.get(header))

const withoutWhitespace = (text: string) => text.replace(WHITESPACE, '')

const namesFile = (dialog: ScreenDialog, filePath: string) =>
  Option.exists(
    dialog.subject,
    (subject) => filePath === subject || filePath.endsWith(`${PATH_SEPARATOR}${subject}`),
  )

const showsAction = (dialog: ScreenDialog, call: ToolCall) =>
  Match.value(actionOf(call.toolName, call.toolInput)).pipe(
    Match.tagsExhaustive({
      RunCommand: (run) =>
        withoutWhitespace(dialog.body.join(LINE_BREAK)) === withoutWhitespace(run.command),
      EditFile: (edit) => namesFile(dialog, edit.filePath),
      WriteFile: (write) => namesFile(dialog, write.filePath),
      UseTool: () => true,
      ScreenDetail: () => true,
    }),
  )

const showsQuestion = (dialog: ScreenDialog, call: ToolCall) =>
  call.toolName === QUESTION_TOOL &&
  Option.match(decodeInput(QuestionInput)(call.toolInput), {
    onNone: () => true,
    onSome: (input) => Arr.some(input.questions, (question) => question.header === dialog.header),
  })

const showsPermission = (dialog: ScreenDialog, call: ToolCall) =>
  call.toolName !== QUESTION_TOOL &&
  Option.match(toolOfHeader(dialog.header), {
    onNone: () => true,
    onSome: (tool) => tool === call.toolName && showsAction(dialog, call),
  })

const isConsistent = (dialog: Option.Option<ScreenDialog>) => (call: ToolCall) =>
  Option.match(dialog, {
    onNone: () => true,
    onSome: (found) =>
      found.kind === 'question' ? showsQuestion(found, call) : showsPermission(found, call),
  })

const queuedPending = (
  pending: readonly PendingPermission[],
  dialog: Option.Option<ScreenDialog>,
): Option.Option<PendingPermission> => {
  const queue = Option.getOrElse(
    Option.flatMap(dialog, (found) => found.queue),
    (): DialogQueue => ({ position: 1, total: 1 }),
  )

  return Arr.get(pending, pending.length - queue.total + queue.position - 1)
}

const hookCall = (pending: PendingPermission): ToolCall => ({
  source: 'hook',
  id: AskId.make(Option.getOrElse(pending.toolUseId, () => `hook-${pending.sequence}`)),
  toolName: pending.toolName,
  toolInput: pending.toolInput,
})

const transcriptCall = (toolUse: ToolUseBlock): ToolCall => ({
  source: 'transcript',
  id: AskId.make(toolUse.id),
  toolName: toolUse.name,
  toolInput: toolUse.input,
})

const screenAskId = (dialog: ScreenDialog) => AskId.make(`screen-${dialogFingerprint(dialog)}`)

const questionFromDialog = (dialog: ScreenDialog): Ask =>
  new QuestionAsk({
    id: screenAskId(dialog),
    source: 'screen',
    questions: [
      new AskQuestion({
        header: dialog.header,
        question: dialog.body.map((line) => line.trim()).join(LINE_BREAK),
        multiSelect: Option.none(),
        choices: pipe(
          dialog.options,
          Arr.filter((option) => !Arr.contains(DIALOG_EXTRA_CHOICES, option.label)),
          Arr.map(
            (option) =>
              new QuestionChoice({
                label: option.label,
                description: Option.liftPredicate(
                  option.details.join(LINE_BREAK),
                  (description) => description.length > 0,
                ),
              }),
          ),
        ),
      }),
    ],
    dialog: Option.some(dialogFingerprint(dialog)),
  })

const permissionFromDialog = (dialog: ScreenDialog): Ask => {
  const tool = Option.getOrElse(toolOfHeader(dialog.header), () => dialog.header)
  const body = dialog.body.join(LINE_BREAK)

  return new PermissionAsk({
    id: screenAskId(dialog),
    source: 'screen',
    tool,
    plugin: dialog.plugin,
    action:
      tool === 'Bash'
        ? new RunCommand({ command: body.trim() })
        : new ScreenDetail({ subject: dialog.subject, text: body }),
    options: askOptionsOf(Option.some(dialog)),
    dialog: Option.some(dialogFingerprint(dialog)),
  })
}

const askFromDialog = (dialog: ScreenDialog): Ask =>
  dialog.kind === 'question' ? questionFromDialog(dialog) : permissionFromDialog(dialog)

const unknownAsk = (evidence: AskEvidence): Ask =>
  new UnknownAsk({
    id: AskId.make(`blocked-${evidence.episode.terminal}-${evidence.episode.stateChangeSeq}`),
    screen: Option.getOrElse(evidence.screen, () => ''),
  })

export const deriveAsk = (evidence: AskEvidence): Ask =>
  pipe(
    Option.firstSomeOf([
      Option.map(queuedPending(evidence.pending, evidence.dialog), hookCall),
      Option.map(evidence.toolUse, transcriptCall),
    ]),
    Option.filter(isConsistent(evidence.dialog)),
    Option.map((call) => askOfCall(call, evidence.dialog)),
    Option.orElse(() => Option.map(evidence.dialog, askFromDialog)),
    Option.getOrElse(() => unknownAsk(evidence)),
  )

export const pendingEdit = (ask: Ask): Option.Option<PendingEdit> =>
  Match.value(ask).pipe(
    Match.tag('PermissionAsk', (permission) =>
      Match.value(permission.action).pipe(
        Match.tag('EditFile', (edit) => Option.some({ permission, edit })),
        Match.orElse(() => Option.none()),
      ),
    ),
    Match.orElse(() => Option.none()),
  )

export const withEditPatch = ({ permission, edit }: PendingEdit, content: string): Ask =>
  new PermissionAsk(
    Struct.evolve(permission, {
      action: () =>
        new EditFile(
          Struct.evolve(edit, {
            patch: () =>
              editPatch(content, {
                oldString: edit.oldString,
                newString: edit.newString,
                replaceAll: edit.replaceAll,
              }),
          }),
        ),
    }),
  )
