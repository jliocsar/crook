import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'

import {
  AskOption,
  AskQuestion,
  EditFile,
  PermissionAsk,
  QuestionAsk,
  RunCommand,
  ScreenDetail,
  UseTool,
  WriteFile,
} from '@crook/domain/Ask'
import type { AskedAction } from '@crook/domain/Ask'
import { AnswerAsk, Approve, ApproveAlways, Decline, Prompt } from '@crook/domain/Command'
import { AskId, PaneId } from '@crook/domain/Ids'
import { PatchHunk } from '@crook/domain/TranscriptMessage'
import { AskDialogUnreadable, AskNotPending } from '@crook/protocol/Commands'
import { ActionProgress, UNCONFIRMED_NOTE } from '@crook/web/atoms/ActionProgress'
import type { CommandProgress } from '@crook/web/atoms/ActionProgress'
import {
  AlwaysNote,
  alwaysNoteFor,
  AskAnswerState,
  AskDetail,
  answerableQuestion,
  answerState,
  askDetail,
  alwaysCaption,
  answerInFlight,
  askTitle,
  isAnswerUnderway,
  permissionButtons,
  withAlwaysNotes,
  withoutAskedCall,
} from '@crook/web/chat/AskModel'
import { ChatItem } from '@crook/web/chat/ChatItems'

import { inputDelivered } from '../HubFakes.ts'

const PANE = PaneId.make('w1:p1')
const ASK = AskId.make('toolu_1')
const CWD = '/home/jliocsar/Projects/crook'

const permission = (action: AskedAction, options: readonly AskOption[] = [], tool = 'Edit') =>
  new PermissionAsk({
    id: ASK,
    source: 'hook',
    tool,
    plugin: Option.none(),
    action,
    options,
    dialog: Option.none(),
  })

const edit = (patch: EditFile['patch'], oldString = 'a', newString = 'b') =>
  new EditFile({
    filePath: `${CWD}/src/Herd.ts`,
    oldString,
    newString,
    replaceAll: false,
    patch,
  })

const approve = new AnswerAsk({ pane: PANE, ask: ASK, answer: new Approve() })

const note = (text: string) => ChatItem.Note({ key: text, text, answersACommand: false })

describe('askTitle', () => {
  it('names what the ask would do', () => {
    expect(askTitle(permission(new RunCommand({ command: 'ls' })))).toBe('Run this command?')
    expect(askTitle(permission(edit(Option.none())))).toBe('Edit Herd.ts?')
    expect(askTitle(permission(new WriteFile({ filePath: `${CWD}/a/New.ts`, content: '' })))).toBe(
      'Write New.ts?',
    )
    expect(askTitle(permission(new UseTool({ input: {} })))).toBe('Use Edit?')
    expect(
      askTitle(permission(new ScreenDetail({ subject: Option.some('src/Herd.ts'), text: '' }))),
    ).toBe('Edit Herd.ts?')
  })
})

describe('askDetail', () => {
  it('shows the patch read from the file, else a diff of the strings, else the summary', () => {
    const hunk = new PatchHunk({
      oldStart: 3,
      oldLines: 1,
      newStart: 3,
      newLines: 1,
      lines: ['-a', '+b'],
    })

    expect(askDetail(permission(edit(Option.some([hunk]))), CWD)).toEqual(
      AskDetail.Diff({ hunks: [hunk], filename: 'src/Herd.ts' }),
    )
    expect(askDetail(permission(edit(Option.some([]))), CWD)).toEqual(
      AskDetail.Diff({
        hunks: [{ lines: ['-a', '+b'] }],
        filename: 'src/Herd.ts',
      }),
    )
    expect(askDetail(permission(edit(Option.none(), '', '')), CWD)).toEqual(
      AskDetail.Summary({ text: 'Edit src/Herd.ts' }),
    )
  })

  it('shows a command as the command alone', () => {
    expect(askDetail(permission(new RunCommand({ command: 'bun run lint' })), CWD)).toEqual(
      AskDetail.Command({ command: 'bun run lint' }),
    )
  })
})

describe('permissionButtons', () => {
  it('offers Yes and Always only when the dialog does, and No always', () => {
    const options = [
      new AskOption({ number: 1, label: 'Yes', choice: 'yes' }),
      new AskOption({ number: 2, label: 'Yes, and always allow', choice: 'always' }),
      new AskOption({ number: 3, label: 'No', choice: 'no' }),
    ]
    const command = new RunCommand({ command: 'ls' })

    expect(permissionButtons(permission(command, options)).map((button) => button.answer)).toEqual([
      new Approve(),
      new ApproveAlways(),
      new Decline({ message: Option.none() }),
    ])
    expect(permissionButtons(permission(command)).map((button) => button.label)).toEqual(['No'])
  })
})

describe('alwaysCaption', () => {
  it("says what Always grants without the dialog's own answer wording or key hint", () => {
    const always = (label: string) =>
      alwaysCaption(
        permission(new RunCommand({ command: 'ls' }), [
          new AskOption({ number: 2, label, choice: 'always' }),
        ]),
      )

    expect(
      always(
        'Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)',
      ),
    ).toEqual(
      Option.some(
        'Always: switch to accept edits (auto-approve file edits and common file commands) for this session',
      ),
    )
    expect(always('Yes, and always allow access to /work from this project')).toEqual(
      Option.some('Always: allow access to /work from this project'),
    )
    expect(always('Yes, and don’t ask again for: npm *')).toEqual(
      Option.some('Always: don’t ask again for: npm *'),
    )
    expect(alwaysCaption(permission(new RunCommand({ command: 'ls' })))).toEqual(Option.none())
  })
})

describe('answerableQuestion', () => {
  const asked = (multiSelect: Option.Option<boolean>) =>
    new AskQuestion({ header: 'Auth', question: 'Which?', multiSelect, choices: [] })
  const ask = (...questions: [AskQuestion, ...AskQuestion[]]) =>
    new QuestionAsk({ id: ASK, source: 'hook', questions, dialog: Option.none() })

  it('answers one question with one choice, and nothing else', () => {
    expect(Option.isSome(answerableQuestion(ask(asked(Option.some(false)))))).toBe(true)
    expect(Option.isSome(answerableQuestion(ask(asked(Option.some(true)))))).toBe(false)
    expect(Option.isSome(answerableQuestion(ask(asked(Option.none()))))).toBe(false)
    expect(
      Option.isSome(answerableQuestion(ask(asked(Option.some(false)), asked(Option.some(false))))),
    ).toBe(false)
  })
})

describe('answerState', () => {
  const progress = (state: CommandProgress, refusal = Option.none<AskNotPending>()) => ({
    state,
    refusal,
    last: Option.some(approve),
  })

  it('follows the answer to this ask from sending to answered', () => {
    const receipt = inputDelivered(approve)

    expect(answerState(progress(ActionProgress.Idle()), ASK)).toEqual(AskAnswerState.Open())
    expect(answerState(progress(ActionProgress.Sending()), ASK)).toEqual(
      AskAnswerState.Answering({ answer: new Approve() }),
    )
    expect(answerState(progress(ActionProgress.Sent({ receipt })), ASK)).toEqual(
      AskAnswerState.Answered({ answer: new Approve() }),
    )
    expect(answerState(progress(ActionProgress.Done({ receipt })), ASK)).toEqual(
      AskAnswerState.Answered({ answer: new Approve() }),
    )
  })

  it('reads AskNotPending as already answered and any other refusal as refused', () => {
    const failed = ActionProgress.Failed({ message: 'Nope.', asksConfirmation: false })

    expect(
      answerState(progress(failed, Option.some(new AskNotPending({ pane: PANE, ask: ASK }))), ASK),
    ).toEqual(AskAnswerState.AlreadyAnswered())
    expect(
      answerState(
        {
          state: failed,
          refusal: Option.some(new AskDialogUnreadable({ pane: PANE })),
          last: Option.some(approve),
        },
        ASK,
      ),
    ).toEqual(AskAnswerState.Refused({ message: 'Nope.' }))
  })

  it('reads an answer the dialog never moved on from as refused, so it can be answered again', () => {
    const receipt = inputDelivered(approve)

    expect(answerState(progress(ActionProgress.Unconfirmed({ receipt })), ASK)).toEqual(
      AskAnswerState.Refused({ message: UNCONFIRMED_NOTE }),
    )
  })

  it('counts an answer as underway only while it is being sent', () => {
    const answer = new Approve()

    expect(isAnswerUnderway(AskAnswerState.Answering({ answer }))).toBe(true)
    expect(answerInFlight(AskAnswerState.Answering({ answer }))).toEqual(Option.some(answer))
    expect(isAnswerUnderway(AskAnswerState.Answered({ answer }))).toBe(false)
    expect(answerInFlight(AskAnswerState.Answered({ answer }))).toEqual(Option.none())
    expect(isAnswerUnderway(AskAnswerState.Open())).toBe(false)
  })

  it('ignores an answer to another ask and any other command', () => {
    const sending = ActionProgress.Sending()

    expect(answerState(progress(sending), AskId.make('toolu_2'))).toEqual(AskAnswerState.Open())
    expect(
      answerState(
        {
          state: sending,
          refusal: Option.none(),
          last: Option.some(new Prompt({ pane: PANE, text: 'go' })),
        },
        ASK,
      ),
    ).toEqual(AskAnswerState.Open())
  })
})

describe('always notes', () => {
  const options = [new AskOption({ number: 2, label: 'Yes, and always allow', choice: 'always' })]
  const ask = permission(new RunCommand({ command: 'ls' }), options)

  it('notes only an Always, after the call it allowed or else the newest item', () => {
    const items = [note('first'), note('last')]

    expect(alwaysNoteFor(ask, new Approve(), items, Option.none())).toEqual(Option.none())
    expect(alwaysNoteFor(ask, new ApproveAlways(), items, Option.none())).toEqual(
      Option.some(
        new AlwaysNote({
          ask: ASK,
          text: 'Commands like this one allowed without asking again',
          after: Option.some('last'),
          session: Option.none(),
        }),
      ),
    )
  })

  it('words the note from the ask, scoped to the session only when the grant is', () => {
    const sessionOptions = [
      new AskOption({
        number: 2,
        label: 'Yes, and switch to accept edits (auto-approve file edits) for this session',
        choice: 'always',
      }),
    ]

    expect(
      Option.map(
        alwaysNoteFor(
          permission(edit(Option.none()), sessionOptions),
          new ApproveAlways(),
          [],
          Option.none(),
        ),
        (found) => found.text,
      ),
    ).toEqual(Option.some('File edits like this one allowed for the rest of the session'))
  })

  it('places a note after its item, and at the end when that item is gone', () => {
    const kept = new AlwaysNote({
      ask: ASK,
      text: 'Allowed',
      after: Option.some('first'),
      session: Option.none(),
    })
    const lost = new AlwaysNote({
      ask: AskId.make('toolu_2'),
      text: 'Also allowed',
      after: Option.some('cleared'),
      session: Option.none(),
    })

    expect(
      withAlwaysNotes([note('first'), note('second')], [kept, lost]).map((item) => item.key),
    ).toEqual(['first', 'always toolu_1', 'second', 'always toolu_2'])
  })

  it('hides no item when no ask is open', () => {
    const items = [note('first')]

    expect(withoutAskedCall(items, Option.none())).toBe(items)
  })
})
