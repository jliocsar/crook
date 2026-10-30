import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { AgentRow, pendingAskSummary } from '@crook/domain/AgentRow'
import {
  type Ask,
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
  askOption,
  askSummary,
} from '@crook/domain/Ask'
import { AskId, PaneId, TabId, TerminalId, WorkspaceId } from '@crook/domain/Ids'
import type { AgentStatus } from '@crook/domain/AgentStatus'

const FOLDER = '/home/jliocsar/Projects/crook'

const permission = (tool: string, action: PermissionAsk['action']) =>
  new PermissionAsk({
    id: AskId.make('toolu_01XXC3'),
    source: 'hook',
    tool,
    plugin: Option.none(),
    action,
    options: [
      new AskOption({ number: 1, label: 'Yes', choice: 'yes' }),
      new AskOption({ number: 2, label: 'Yes, and always allow access', choice: 'always' }),
      new AskOption({ number: 3, label: 'No', choice: 'no' }),
    ],
    dialog: Option.some('bash-ls-dialog'),
  })

const question = new QuestionAsk({
  id: AskId.make('toolu_016q'),
  source: 'transcript',
  questions: [
    new AskQuestion({
      header: 'Color',
      question: 'Which color do you prefer?',
      multiSelect: Option.some(false),
      choices: [new QuestionChoice({ label: 'Red', description: Option.some('warm') })],
    }),
  ],
  dialog: Option.none(),
})

const rowAsking = (status: AgentStatus, ask: Option.Option<Ask>) =>
  new AgentRow({
    pane: PaneId.make('w1:p1'),
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    terminal: TerminalId.make('term_1'),
    status,
    title: 'EX-253 Example feature',
    label: Option.none(),
    createdByCrook: false,
    cwd: FOLDER,
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq: 4,
    statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
    beforeHandoff: Option.none(),
    ask,
    runningSubagents: Option.none(),
  })

describe('askSummary', () => {
  it("names the tool and what it acts on, relative to the agent's folder", () => {
    const summaryOf = (ask: Ask) => askSummary(ask, FOLDER)

    expect(
      summaryOf(permission('Bash', new RunCommand({ command: 'bun run lint\nbun run test' }))),
    ).toEqual(Option.some('Bash bun run lint'))
    expect(
      summaryOf(
        permission(
          'Edit',
          new EditFile({
            filePath: `${FOLDER}/packages/web/src/AgentCard.tsx`,
            oldString: 'a',
            newString: 'b',
            replaceAll: false,
            patch: Option.none(),
          }),
        ),
      ),
    ).toEqual(Option.some('Edit packages/web/src/AgentCard.tsx'))
    expect(
      summaryOf(permission('Write', new WriteFile({ filePath: '/etc/hosts', content: '' }))),
    ).toEqual(Option.some('Write /etc/hosts'))
    expect(
      summaryOf(permission('WebFetch', new UseTool({ input: { url: 'https://effect.website' } }))),
    ).toEqual(Option.some('WebFetch'))
    expect(
      summaryOf(
        permission('Edit', new ScreenDetail({ subject: Option.some('ask.txt'), text: '' })),
      ),
    ).toEqual(Option.some('Edit ask.txt'))
    expect(summaryOf(question)).toEqual(Option.some('Which color do you prefer?'))
    expect(summaryOf(new UnknownAsk({ id: AskId.make('blocked-term_1-4'), screen: '' }))).toEqual(
      Option.none(),
    )
  })

  it('finds the option that answers a choice', () => {
    const ask = permission('Bash', new RunCommand({ command: 'ls' }))

    expect(Option.map(askOption(ask, 'always'), (option) => option.number)).toEqual(Option.some(2))
    expect(askOption(ask, 'other')).toEqual(Option.none())
  })
})

describe('pendingAskSummary', () => {
  const ask = Option.some<Ask>(permission('Bash', new RunCommand({ command: 'ls' })))

  it('summarises the ask the row carries', () => {
    expect(pendingAskSummary(rowAsking('blocked', ask))).toEqual(Option.some('Bash ls'))
    expect(pendingAskSummary(rowAsking('blocked', Option.none()))).toEqual(Option.none())
  })

  it('carries the ask across the JSON codec the wire uses', () => {
    const codec = Schema.fromJsonString(Schema.toCodecJson(AgentRow))
    const rows = [
      rowAsking('blocked', ask),
      rowAsking('blocked', Option.some(question)),
      rowAsking(
        'blocked',
        Option.some(new UnknownAsk({ id: AskId.make('blocked-term_1-4'), screen: '❯ 1. Yes' })),
      ),
    ]

    expect(rows.map((row) => Schema.decodeSync(codec)(Schema.encodeSync(codec)(row)))).toEqual(rows)
  })
})
