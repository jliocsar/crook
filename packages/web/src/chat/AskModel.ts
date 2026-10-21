import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { askOption, askSummary, relativeToFolder } from '@crook/domain/Ask'
import type { Ask, AskQuestion, PermissionAsk, QuestionAsk } from '@crook/domain/Ask'
import { Approve, ApproveAlways, Decline } from '@crook/domain/Command'
import type { AskAnswer, Command } from '@crook/domain/Command'
import type { AskId } from '@crook/domain/Ids'
import { AskNotPending } from '@crook/protocol/Commands'
import { ActionProgress } from '@crook/web/atoms/ActionProgress'
import { ChatItem } from '@crook/web/chat/ChatItems'
import type { CommandAction } from '@crook/web/chat/CommandAction'
import { editHunks, fileName } from '@crook/web/chat/ToolView'
import type { DiffHunk } from '@crook/web/components/ui/diff-view'

export type AskDetail = Data.TaggedEnum<{
  Command: { readonly command: string }
  Diff: { readonly hunks: readonly DiffHunk[]; readonly filename: string }
  File: { readonly content: string; readonly filename: string }
  Input: { readonly text: string }
  Screen: { readonly text: string }
  Summary: { readonly text: string }
}>

export type AskAnswerState = Data.TaggedEnum<{
  Open: Record<never, never>
  Answering: { readonly answer: AskAnswer }
  Answered: { readonly answer: AskAnswer }
  AlreadyAnswered: Record<never, never>
  Refused: { readonly message: string }
}>

export type AnswerProgress = Pick<CommandAction, 'state' | 'refusal' | 'last'>

export interface AskButton {
  readonly label: string
  readonly description: string
  readonly answer: AskAnswer
}

const YES_LABEL = 'Yes'
const ALWAYS_LABEL = 'Always'
const NO_LABEL = 'No'
const JSON_INDENT = 2
const NOTE_KEY_PREFIX = 'always'

export const RUN_COMMAND_TITLE = 'Run this command?'
export const UNKNOWN_ASK_TITLE = "Claude is waiting on something crook can't read"

export const AskDetail = Data.taggedEnum<AskDetail>()

export const AskAnswerState = Data.taggedEnum<AskAnswerState>()

export class AlwaysNote extends Data.Class<{
  readonly ask: AskId
  readonly text: string
  readonly after: Option.Option<string>
}> {}

const isTool = ChatItem.$is('Tool')

const isAlreadyAnswered = Schema.is(AskNotPending)

const isApproveAlways = Schema.is(ApproveAlways)

const permissionTitle = (ask: PermissionAsk): string =>
  Match.value(ask.action).pipe(
    Match.tagsExhaustive({
      RunCommand: () => RUN_COMMAND_TITLE,
      EditFile: (edit) => `Edit ${fileName(edit.filePath)}?`,
      WriteFile: (write) => `Write ${fileName(write.filePath)}?`,
      UseTool: () => `Use ${ask.tool}?`,
      ScreenDetail: (detail) =>
        Option.match(detail.subject, {
          onNone: () => `Use ${ask.tool}?`,
          onSome: (subject) => `${ask.tool} ${fileName(subject)}?`,
        }),
    }),
  )

export const askTitle = (ask: Ask): string =>
  Match.value(ask).pipe(
    Match.tagsExhaustive({
      PermissionAsk: permissionTitle,
      QuestionAsk: (question) => Arr.headNonEmpty(question.questions).question,
      UnknownAsk: () => UNKNOWN_ASK_TITLE,
    }),
  )

export const askTool = (ask: PermissionAsk): string =>
  Option.match(ask.plugin, {
    onNone: () => ask.tool,
    onSome: (plugin) => `${ask.tool} · from the ${plugin} plugin`,
  })

export const askDetail = (ask: PermissionAsk, cwd: string): AskDetail =>
  Match.value(ask.action).pipe(
    Match.tagsExhaustive({
      RunCommand: (run) => AskDetail.Command({ command: run.command }),
      EditFile: (edit) =>
        pipe(
          edit.patch,
          Option.filter(Arr.isReadonlyArrayNonEmpty),
          Option.orElse(() =>
            Option.liftPredicate(
              editHunks(edit.oldString, edit.newString),
              () => edit.oldString !== '' || edit.newString !== '',
            ),
          ),
          Option.match({
            onSome: (hunks) =>
              AskDetail.Diff({ hunks, filename: relativeToFolder(cwd, edit.filePath) }),
            onNone: () =>
              AskDetail.Summary({
                text: Option.getOrElse(askSummary(ask, cwd), () => ask.tool),
              }),
          }),
        ),
      WriteFile: (write) =>
        AskDetail.File({ content: write.content, filename: relativeToFolder(cwd, write.filePath) }),
      UseTool: (use) => AskDetail.Input({ text: JSON.stringify(use.input, null, JSON_INDENT) }),
      ScreenDetail: (detail) => AskDetail.Screen({ text: detail.text }),
    }),
  )

export const permissionButtons = (ask: PermissionAsk): readonly AskButton[] =>
  Arr.getSomes([
    Option.map(askOption(ask, 'yes'), (option): AskButton => ({
      label: YES_LABEL,
      description: option.label,
      answer: new Approve(),
    })),
    Option.map(askOption(ask, 'always'), (option): AskButton => ({
      label: ALWAYS_LABEL,
      description: option.label,
      answer: new ApproveAlways(),
    })),
    Option.some<AskButton>({
      label: NO_LABEL,
      description: Option.match(askOption(ask, 'no'), {
        onNone: () => NO_LABEL,
        onSome: (option) => option.label,
      }),
      answer: new Decline({ message: Option.none() }),
    }),
  ])

export const answerableQuestion = (ask: QuestionAsk): Option.Option<AskQuestion> =>
  Option.filter(
    Option.some(Arr.headNonEmpty(ask.questions)),
    (question) => ask.questions.length === 1 && Option.contains(question.multiSelect, false),
  )

const answerTo = (command: Command, ask: AskId): Option.Option<AskAnswer> =>
  Match.value(command).pipe(
    Match.tag('AnswerAsk', (answering) =>
      Option.map(
        Option.liftPredicate(answering, (sent) => sent.ask === ask),
        (sent) => sent.answer,
      ),
    ),
    Match.orElse(() => Option.none<AskAnswer>()),
  )

export const answerState = (progress: AnswerProgress, ask: AskId): AskAnswerState =>
  Option.match(
    Option.flatMap(progress.last, (command) => answerTo(command, ask)),
    {
      onNone: () => AskAnswerState.Open(),
      onSome: (answer) =>
        ActionProgress.$match(progress.state, {
          Idle: () => AskAnswerState.Open(),
          Sending: () => AskAnswerState.Answering({ answer }),
          Sent: () => AskAnswerState.Answered({ answer }),
          Done: () => AskAnswerState.Answered({ answer }),
          Failed: ({ message }) =>
            Option.exists(progress.refusal, isAlreadyAnswered)
              ? AskAnswerState.AlreadyAnswered()
              : AskAnswerState.Refused({ message }),
        }),
    },
  )

export const isAnswerUnderway = AskAnswerState.$match({
  Open: () => false,
  Answering: () => true,
  Answered: () => true,
  AlreadyAnswered: () => false,
  Refused: () => false,
})

const alwaysNoteOf = (ask: PermissionAsk, items: readonly ChatItem[]): Option.Option<AlwaysNote> =>
  Option.map(
    askOption(ask, 'always'),
    (option) =>
      new AlwaysNote({
        ask: ask.id,
        text: option.label,
        after: pipe(
          Arr.findFirst(items, (item) => isTool(item) && item.call.id === ask.id),
          Option.orElse(() => Arr.last(items)),
          Option.map((item) => item.key),
        ),
      }),
  )

export const alwaysNoteFor = (
  ask: Ask,
  answer: AskAnswer,
  items: readonly ChatItem[],
): Option.Option<AlwaysNote> =>
  Match.value(ask).pipe(
    Match.tag('PermissionAsk', (permission) =>
      Option.flatMap(Option.liftPredicate(answer, isApproveAlways), () =>
        alwaysNoteOf(permission, items),
      ),
    ),
    Match.orElse(() => Option.none<AlwaysNote>()),
  )

const noteItem = (note: AlwaysNote): ChatItem =>
  ChatItem.Note({ key: `${NOTE_KEY_PREFIX} ${note.ask}`, text: note.text })

export const withAlwaysNotes = (
  items: readonly ChatItem[],
  notes: readonly AlwaysNote[],
): readonly ChatItem[] => {
  const isPlaced = (note: AlwaysNote) =>
    Option.exists(note.after, (key) => Arr.some(items, (item) => item.key === key))

  return [
    ...Arr.flatMap(items, (item) => [
      item,
      ...pipe(
        notes,
        Arr.filter((note) => Option.contains(note.after, item.key)),
        Arr.map(noteItem),
      ),
    ]),
    ...pipe(
      notes,
      Arr.filter((note) => !isPlaced(note)),
      Arr.map(noteItem),
    ),
  ]
}

export const withoutAskedCall = (
  items: readonly ChatItem[],
  ask: Option.Option<AskId>,
): readonly ChatItem[] =>
  Option.match(ask, {
    onNone: () => items,
    onSome: (id) => Arr.filter(items, (item) => !(isTool(item) && item.call.id === id)),
  })
