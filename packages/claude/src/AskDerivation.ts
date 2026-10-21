import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Hash from 'effect/Hash'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Struct from 'effect/Struct'

import { editPatch } from '@crook/claude/EditPatch'
import type { PendingPermission } from '@crook/claude/HookLedger'
import type { PermissionDialog } from '@crook/claude/PermissionDialog'
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
  readonly dialog: Option.Option<PermissionDialog>
  readonly pending: Option.Option<PendingPermission>
  readonly toolUse: Option.Option<ToolUseBlock>
}

interface ToolCall {
  readonly source: AskSource
  readonly id: AskId
  readonly toolName: string
  readonly toolInput: Schema.Json
}

const YES_LABEL = 'Yes'
const NO_LABEL = 'No'
const LINE_BREAK = '\n'
const ALWAYS_PREFIXES = ['Yes, and always allow', 'Yes, and switch to accept edits']
const DIALOG_EXTRA_CHOICES = ['Type something.', 'Chat about this']

export const QUESTION_TOOL = 'AskUserQuestion'

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

export const optionChoice = (label: string): AskChoice => {
  if (label === YES_LABEL) {
    return 'yes'
  }

  if (label === NO_LABEL) {
    return 'no'
  }

  return Arr.some(ALWAYS_PREFIXES, (prefix) => label.startsWith(prefix)) ? 'always' : 'other'
}

const askOptionsOf = (dialog: Option.Option<PermissionDialog>): readonly AskOption[] =>
  Option.match(dialog, {
    onNone: () => [],
    onSome: (found) =>
      found.kind === 'permission'
        ? found.options.map(
            (option) =>
              new AskOption({
                number: option.number,
                label: option.label,
                choice: optionChoice(option.label),
              }),
          )
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

const questionAskOf = (call: ToolCall): Option.Option<Ask> =>
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
      }),
  )

const permissionAskOf = (call: ToolCall, dialog: Option.Option<PermissionDialog>): Ask =>
  new PermissionAsk({
    id: call.id,
    source: call.source,
    tool: call.toolName,
    plugin: Option.flatMap(dialog, (found) => found.plugin),
    action: actionOf(call.toolName, call.toolInput),
    options: askOptionsOf(dialog),
  })

const askOfCall = (call: ToolCall, dialog: Option.Option<PermissionDialog>): Ask =>
  call.toolName === QUESTION_TOOL
    ? Option.getOrElse(questionAskOf(call), () => permissionAskOf(call, dialog))
    : permissionAskOf(call, dialog)

export const toolOfHeader = (header: string): Option.Option<string> =>
  Option.fromUndefinedOr(HEADER_TOOLS.get(header))

const isConsistent = (dialog: Option.Option<PermissionDialog>) => (call: ToolCall) =>
  Option.match(dialog, {
    onNone: () => true,
    onSome: (found) =>
      found.kind === 'question'
        ? call.toolName === QUESTION_TOOL
        : call.toolName !== QUESTION_TOOL &&
          Option.match(toolOfHeader(found.header), {
            onNone: () => true,
            onSome: (tool) => tool === call.toolName,
          }),
  })

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

const screenAskId = (dialog: PermissionDialog) => AskId.make(`screen-${Hash.string(dialog.text)}`)

const questionFromDialog = (dialog: PermissionDialog): Ask =>
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
  })

const permissionFromDialog = (dialog: PermissionDialog): Ask => {
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
  })
}

const askFromDialog = (dialog: PermissionDialog): Ask =>
  dialog.kind === 'question' ? questionFromDialog(dialog) : permissionFromDialog(dialog)

const unknownAsk = (evidence: AskEvidence): Ask =>
  new UnknownAsk({
    id: AskId.make(`blocked-${evidence.episode.terminal}-${evidence.episode.stateChangeSeq}`),
    screen: Option.getOrElse(evidence.screen, () => ''),
  })

export const deriveAsk = (evidence: AskEvidence): Ask =>
  pipe(
    Option.firstSomeOf([
      Option.map(evidence.pending, hookCall),
      Option.map(evidence.toolUse, transcriptCall),
    ]),
    Option.filter(isConsistent(evidence.dialog)),
    Option.map((call) => askOfCall(call, evidence.dialog)),
    Option.orElse(() => Option.map(evidence.dialog, askFromDialog)),
    Option.getOrElse(() => unknownAsk(evidence)),
  )

export const editToPatch = (ask: Ask): Option.Option<EditFile> =>
  Match.value(ask).pipe(
    Match.tag('PermissionAsk', (permission) =>
      Match.value(permission.action).pipe(
        Match.tag('EditFile', (edit) => Option.some(edit)),
        Match.orElse(() => Option.none()),
      ),
    ),
    Match.orElse(() => Option.none()),
  )

export const withEditPatch = (ask: Ask, content: string): Ask =>
  Match.value(ask).pipe(
    Match.tag('PermissionAsk', (permission): Ask =>
      Match.value(permission.action).pipe(
        Match.tag(
          'EditFile',
          (edit) =>
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
            ),
        ),
        Match.orElse(() => permission),
      ),
    ),
    Match.orElse((other) => other),
  )
