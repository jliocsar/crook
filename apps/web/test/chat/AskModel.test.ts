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
import { Approve, ApproveAlways, Decline } from '@crook/domain/Command'
import { AskId } from '@crook/domain/Ids'
import { PatchHunk } from '@crook/domain/TranscriptMessage'
import {
  AlwaysNote,
  alwaysNoteFor,
  AskDetail,
  answerableQuestion,
  askDetail,
  alwaysCaption,
  askTitle,
  laptopOnlyOptions,
  permissionButtons,
  withAlwaysNotes,
  withoutAskedCall,
} from '@crook/web/chat/AskModel'
import { ChatItem } from '@crook/web/chat/ChatItems'

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

describe('an MCP tool in an ask', () => {
  it('titles the ask in words', () => {
    const ask = new PermissionAsk({
      id: ASK,
      source: 'hook',
      tool: 'mcp__plannotator__send_message',
      plugin: Option.none(),
      action: new UseTool({ input: {} }),
      options: [],
      dialog: Option.none(),
    })

    expect(askTitle(ask)).toBe('Use send message from plannotator?')
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

describe('laptopOnlyOptions', () => {
  const command = new RunCommand({ command: 'ls' })
  const labelled = (labels: readonly (readonly [string, AskOption['choice']])[]) =>
    labels.map(([label, choice], index) => new AskOption({ number: index + 1, label, choice }))

  it('names what the buttons cannot answer, and nothing they can', () => {
    const options = labelled([
      ['Yes', 'yes'],
      ['Yes, and don’t ask again for: npm *', 'always'],
      ['Yes, and switch to auto mode · auto mode handles these prompts for you', 'other'],
      ['No', 'no'],
    ])

    expect(laptopOnlyOptions(permission(command, options))).toEqual([
      'Yes, and switch to auto mode · auto mode handles these prompts for you',
    ])
  })

  it('names a second lasting option, which the one Always button does not answer', () => {
    const options = labelled([
      ['Yes', 'yes'],
      ['Yes, allow reading from src/ from this project', 'always'],
      ['Yes, and always allow access to /tmp from this project', 'always'],
      ['No', 'no'],
    ])

    expect(laptopOnlyOptions(permission(command, options))).toEqual([
      'Yes, and always allow access to /tmp from this project',
    ])
  })

  it('names every option of a dialog with no plain yes, without its key hint', () => {
    const options = labelled([
      ['Yes, and use auto mode', 'other'],
      ['Yes, and manually approve edits (shift+tab)', 'other'],
      ['No, keep planning', 'other'],
    ])
    const ask = permission(command, options)

    expect(permissionButtons(ask).map((button) => button.label)).toEqual(['No'])
    expect(laptopOnlyOptions(ask)).toEqual([
      'Yes, and use auto mode',
      'Yes, and manually approve edits',
      'No, keep planning',
    ])
  })

  it('says nothing when the buttons cover the dialog, or no dialog was read', () => {
    const options = labelled([
      ['Yes', 'yes'],
      ['No, and tell Claude what to do differently (esc)', 'no'],
    ])

    expect(laptopOnlyOptions(permission(command, options))).toEqual([])
    expect(laptopOnlyOptions(permission(command))).toEqual([])
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
