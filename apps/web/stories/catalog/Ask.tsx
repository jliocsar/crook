import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { AgentRow } from '@crook/domain/AgentRow'
import {
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
import type { Ask, AskChoice } from '@crook/domain/Ask'
import { AnswerAsk, Approve } from '@crook/domain/Command'
import { AskId } from '@crook/domain/Ids'
import { PatchHunk } from '@crook/domain/TranscriptMessage'
import { AskDialogUnreadable, AskNotPending } from '@crook/protocol/Commands'

import { liveWith } from '../../test/AppWiring.tsx'
import { agent, herd, LAPTOP, machine } from '../../test/HerdFixtures.ts'
import { inputDelivered } from '../../test/HubFakes.ts'
import { caughtUp, chunk, CWD, opened, prompt, toolUse } from '../../test/TranscriptFixtures.ts'
import { UNCONFIRMED_NOTE } from '@crook/web/atoms/ActionProgress'

import { chatStory } from '../ChatFixtures.ts'
import { CHAT_TITLE, PANE } from '../Fixtures.ts'
import { clicks, seesText, types, typesInto } from '../StageDom.ts'
import { step } from '../Story.tsx'
import type { LinkStage, StoryMaker } from '../Story.tsx'

const ASK_DOCK = '[data-slot="ask-dock"]'
const LAPTOP_OPTIONS = '[data-slot="ask-laptop-options"]'
const BASH_ID = AskId.make('toolu_bash')
const EDIT_ID = AskId.make('toolu_edit')
const SCREEN_ID = AskId.make('screen-928861183')

const LONG_COMMAND =
  'bun run lint && bun run typecheck && bun run test && bun run fmt:check && git add -A && git commit -m "fix(web): keep the banner still" && git push origin HEAD'

const ALWAYS_LABEL =
  "Yes, and don't ask again for bun run lint commands in /home/jliocsar/Projects/crook"

const options = (labels: readonly (readonly [string, AskChoice])[]) =>
  labels.map(([label, choice], index) => new AskOption({ number: index + 1, label, choice }))

const THREE_OPTIONS = options([
  ['Yes', 'yes'],
  [ALWAYS_LABEL, 'always'],
  ['No, and tell Claude what to do differently (esc)', 'no'],
])

const bashAsk = (command = 'bun run lint', answers = THREE_OPTIONS) =>
  new PermissionAsk({
    id: BASH_ID,
    source: 'hook',
    tool: 'Bash',
    plugin: Option.none(),
    action: new RunCommand({ command }),
    options: answers,
    dialog: Option.some('fingerprint'),
  })

const editAsk = new PermissionAsk({
  id: EDIT_ID,
  source: 'hook',
  tool: 'Edit',
  plugin: Option.none(),
  action: new EditFile({
    filePath: `${CWD}/packages/hub/src/Herd.ts`,
    oldString: 'const herd = 1',
    newString: 'const herd = 2',
    replaceAll: false,
    patch: Option.some([
      new PatchHunk({
        oldStart: 4,
        oldLines: 3,
        newStart: 4,
        newLines: 3,
        lines: [' import { Herd }', '-const herd = 1', '+const herd = 2'],
      }),
    ]),
  }),
  options: THREE_OPTIONS,
  dialog: Option.some('fingerprint'),
})

const writeAsk = new PermissionAsk({
  id: AskId.make('toolu_write'),
  source: 'hook',
  tool: 'Write',
  plugin: Option.none(),
  action: new WriteFile({ filePath: `${CWD}/src/New.ts`, content: 'export const brandNew = 1\n' }),
  options: THREE_OPTIONS,
  dialog: Option.some('fingerprint'),
})

const toolAsk = new PermissionAsk({
  id: AskId.make('toolu_tool'),
  source: 'hook',
  tool: 'mcp__plannotator__send_message',
  plugin: Option.some('plannotator'),
  action: new UseTool({ input: { thread: 'jc-142', body: 'Done.' } }),
  options: THREE_OPTIONS,
  dialog: Option.some('fingerprint'),
})

const screenAsk = new PermissionAsk({
  id: AskId.make('toolu_screen'),
  source: 'screen',
  tool: 'Bash',
  plugin: Option.none(),
  action: new ScreenDetail({ subject: Option.some('Bash command'), text: 'rm -rf tmp/' }),
  options: THREE_OPTIONS,
  dialog: Option.some('fingerprint'),
})

const question = (multiSelect: Option.Option<boolean>, count = 1) =>
  new QuestionAsk({
    id: AskId.make('toolu_question'),
    source: 'hook',
    questions: [
      new AskQuestion({
        header: 'Auth',
        question: 'Which login should the hub use?',
        multiSelect,
        choices: [
          new QuestionChoice({ label: 'exe.dev', description: Option.some('The proxy login') }),
          new QuestionChoice({ label: 'Token', description: Option.none() }),
        ],
      }),
      ...Array.from(
        { length: count - 1 },
        (_unused, index) =>
          new AskQuestion({
            header: `Port ${index + 1}`,
            question: `Which port for service ${index + 1}?`,
            multiSelect,
            choices: [new QuestionChoice({ label: '8080', description: Option.none() })],
          }),
      ),
    ],
    dialog: Option.some('fingerprint'),
  })

const unknownAsk = new UnknownAsk({
  id: AskId.make('toolu_unknown'),
  screen: 'Do you want to proceed?\n 1. Yes\n 2. No',
})

const blockedRow = (ask: Ask, seq = 1): AgentRow =>
  agent('w1:p1', 'blocked', { ask, title: CHAT_TITLE, seq, secondsAgo: 30 })

const blocked = (ask: Ask) =>
  liveWith(herd([machine(LAPTOP, [blockedRow(ask)], { agentVersion: '0.0.2' })]))

const LEAD_IN = [
  opened(),
  chunk(0, 20, [
    prompt(0, 'Lint the web package'),
    toolUse(10, 'toolu_bash', 'Bash', { command: 'bun run lint' }),
  ]),
  caughtUp(20),
]

const askStory = (slug: string, title: string, ask: Ask, shows = ASK_DOCK) =>
  chatStory({ slug, title, link: blocked(ask), events: LEAD_IN, shows: { selector: shows } })

const answeredApprove = new AnswerAsk({ pane: PANE, ask: BASH_ID, answer: new Approve() })

const sameDialogAsk = new PermissionAsk({
  id: SCREEN_ID,
  source: 'screen',
  tool: 'Bash',
  plugin: Option.none(),
  action: new RunCommand({ command: 'bun run lint' }),
  options: THREE_OPTIONS,
  dialog: Option.some('fingerprint'),
})

export const ASK_STORIES: readonly StoryMaker[] = [
  askStory('permission-command', 'Ask, run a command', bashAsk()),
  askStory('permission-long-command', 'Ask, a long command', bashAsk(LONG_COMMAND)),
  askStory('permission-edit', 'Ask, an edit as its diff', editAsk),
  askStory('permission-write', 'Ask, write a file', writeAsk),
  chatStory({
    slug: 'permission-tool',
    title: 'Ask, a plugin tool',
    link: blocked(toolAsk),
    events: LEAD_IN,
    shows: { text: 'Use send message from plannotator?' },
  }),
  askStory('permission-screen', 'Ask, read off the screen', screenAsk),
  askStory(
    'permission-yes-no-only',
    'Ask, only the answers the dialog shows',
    bashAsk(
      'bun run lint',
      options([
        ['Yes', 'yes'],
        ['No', 'no'],
      ]),
    ),
  ),
  askStory(
    'permission-webfetch',
    'Ask, a fetch whose dialog ends on an answer',
    new PermissionAsk({
      id: AskId.make('toolu_fetch'),
      source: 'hook',
      tool: 'WebFetch',
      plugin: Option.none(),
      action: new UseTool({
        input: { url: 'https://example.com/', prompt: 'What is the title of this page?' },
      }),
      options: options([
        ['Yes', 'yes'],
        ["Yes, and don't ask again for example.com", 'always'],
        ['No, and tell Claude what to do differently (esc)', 'no'],
      ]),
      dialog: Option.some('fingerprint'),
    }),
  ),
  chatStory({
    slug: 'permission-laptop-option',
    title: 'Ask, an option only the laptop can answer',
    link: blocked(
      bashAsk(
        'npm --version',
        options([
          ['Yes', 'yes'],
          ['Yes, and don’t ask again for: npm *', 'always'],
          ['Yes, and switch to auto mode · auto mode handles these prompts for you', 'other'],
          ['No', 'no'],
        ]),
      ),
    ),
    events: LEAD_IN,
    shows: { selector: LAPTOP_OPTIONS },
  }),
  chatStory({
    slug: 'permission-read-outside',
    title: 'Ask, a read outside the project, with a lasting no',
    link: blocked(
      new PermissionAsk({
        id: AskId.make('toolu_read'),
        source: 'hook',
        tool: 'Read',
        plugin: Option.none(),
        action: new UseTool({ input: { file_path: '/etc/hostname' } }),
        options: options([
          ['Yes, and keep allowing any reads outside the working directories', 'always'],
          ['No, and block reads outside the working directories from now on', 'other'],
          ['No, and ask again next time', 'no'],
          ['Yes, but ask again next time', 'yes'],
        ]),
        dialog: Option.some('fingerprint'),
      }),
    ),
    events: LEAD_IN,
    shows: { selector: LAPTOP_OPTIONS },
  }),
  chatStory({
    slug: 'permission-no-yes',
    title: 'Ask, a dialog with no plain yes',
    link: blocked(
      new PermissionAsk({
        id: AskId.make('toolu_plan'),
        source: 'hook',
        tool: 'ExitPlanMode',
        plugin: Option.none(),
        action: new UseTool({ input: { plan: 'Create a.txt holding the word hi.' } }),
        options: options([
          ['Yes, and use auto mode', 'other'],
          ['Yes, manually approve edits', 'other'],
          ['Tell Claude what to change shift+tab to approve with this feedback', 'other'],
        ]),
        dialog: Option.some('fingerprint'),
      }),
    ),
    events: LEAD_IN,
    shows: { selector: LAPTOP_OPTIONS },
  }),
  askStory(
    'permission-unreadable',
    'Ask, a dialog crook could not read',
    new PermissionAsk({
      id: BASH_ID,
      source: 'transcript',
      tool: 'Bash',
      plugin: Option.none(),
      action: new RunCommand({ command: 'bun run lint' }),
      options: [],
      dialog: Option.none(),
    }),
  ),
  askStory('question', 'Ask, a question to answer', question(Option.some(false))),
  askStory(
    'question-multi-select',
    'Ask, a question with many answers',
    question(Option.some(true)),
  ),
  askStory(
    'question-list',
    'Ask, several questions crook cannot answer',
    question(Option.some(false), 3),
  ),
  askStory('unknown', 'Ask, a screen crook cannot read', unknownAsk),
  chatStory({
    slug: 'answering',
    title: 'Ask, answering',
    shows: { selector: '[data-slot="button"][disabled] [data-slot="spinner"]' },
    link: blocked(bashAsk()),
    events: LEAD_IN,
    arrange: ({ link }) =>
      Effect.andThen(
        Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(answeredApprove))),
        link.commandAnswers.close,
      ),
    settle: () => clicks('Yes'),
  }),
  chatStory({
    slug: 'declining',
    title: 'Ask, a decline with a message on its way',
    shows: { selector: '[data-machine="ask-answer"][data-state="Open"] button:disabled' },
    link: blocked(bashAsk()),
    events: LEAD_IN,
    arrange: ({ link }) => link.commandAnswers.close,
    settle: () => Effect.andThen(types(/./u, 'Run the tests first'), clicks('Decline and send')),
  }),
  chatStory({
    slug: 'answered',
    title: 'Ask, answered and waiting for Claude',
    link: blocked(bashAsk()),
    events: LEAD_IN,
    arrange: ({ link }) =>
      Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(answeredApprove))),
    settle: () => clicks('Yes'),
    shows: { text: 'Answered. Waiting for Claude to move on.' },
  }),
  chatStory({
    slug: 'answer-gives-up',
    title: 'Ask, answered and the dialog never moving on',
    link: blocked(bashAsk()),
    sentBound: Duration.millis(200),
    events: LEAD_IN,
    arrange: ({ link }) =>
      Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(answeredApprove))),
    settle: () => clicks('Yes'),
    shows: { text: UNCONFIRMED_NOTE },
  }),
  chatStory({
    slug: 'already-answered',
    title: 'Ask, already answered elsewhere',
    shows: { text: 'Already answered' },
    link: blocked(bashAsk()),
    events: LEAD_IN,
    arrange: ({ link }) =>
      Ref.set(link.commandAnswer, Exit.fail(new AskNotPending({ pane: PANE, ask: BASH_ID }))),
    settle: () => clicks('Yes'),
  }),
  chatStory({
    slug: 'refused',
    title: 'Ask, the answer was refused',
    link: blocked(bashAsk()),
    events: LEAD_IN,
    arrange: ({ link }) =>
      Ref.set(link.commandAnswer, Exit.fail(new AskDialogUnreadable({ pane: PANE }))),
    settle: () => clicks('Yes'),
    shows: { text: 'could not read the dialog' },
  }),
  chatStory({
    slug: 'decline-composer',
    title: 'Ask, declining with a message',
    link: blocked(bashAsk()),
    events: LEAD_IN,
    settle: () => types(/./u, 'Run the tests first'),
    shows: { selector: 'button[aria-label="Decline and send"]' },
  }),
  chatStory({
    slug: 'question-answering',
    title: 'Ask, a typed answer on its way',
    shows: { selector: '[data-slot="questionnaire-submit"][disabled]' },
    link: blocked(question(Option.some(false))),
    events: LEAD_IN,
    arrange: ({ link }) =>
      Effect.andThen(
        Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(answeredApprove))),
        link.commandAnswers.close,
      ),
    settle: () => Effect.andThen(typesInto('Something else…', 'Use both'), clicks('Answer')),
  }),
  chatStory({
    slug: 'next-ask',
    title: 'Ask, one ask gives way to the next',
    shows: { text: 'Run this command?' },
    ends: { text: 'Edit Herd.ts?' },
    link: blocked(bashAsk()),
    events: LEAD_IN,
    arrange: ({ link }) =>
      Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(answeredApprove))),
    settle: () => seesText('Run this command?'),
    timeline: [
      step<LinkStage>(500, 'Tap Yes', () => clicks('Yes')),
      step<LinkStage>(700, 'Claude moves on to an edit', ({ link }) =>
        SubscriptionRef.set(
          link.state,
          liveWith(herd([machine(LAPTOP, [blockedRow(editAsk, 2)], { agentVersion: '0.0.2' })])),
        ),
      ),
    ],
  }),
  chatStory({
    slug: 'answered-before-herdr-moves',
    title: 'Ask, the dialog closes before herdr moves off blocked',
    shows: { text: 'Run this command?' },
    ends: { text: 'Edit Herd.ts?' },
    link: blocked(bashAsk()),
    events: LEAD_IN,
    arrange: ({ link }) =>
      Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(answeredApprove))),
    settle: () => seesText('Run this command?'),
    timeline: [
      step<LinkStage>(500, 'Tap Yes', () => clicks('Yes')),
      step<LinkStage>(700, 'The pid file leaves waiting, herdr still reads blocked', ({ link }) =>
        SubscriptionRef.set(
          link.state,
          liveWith(
            herd([
              machine(
                LAPTOP,
                [
                  agent('w1:p1', 'blocked', {
                    ask: bashAsk(),
                    title: CHAT_TITLE,
                    seq: 1,
                    secondsAgo: 30,
                    claudeWaiting: false,
                  }),
                ],
                { agentVersion: '0.0.2' },
              ),
            ]),
          ),
        ),
      ),
      step<LinkStage>(200, 'Claude moves on to an edit', ({ link }) =>
        SubscriptionRef.set(
          link.state,
          liveWith(herd([machine(LAPTOP, [blockedRow(editAsk, 2)], { agentVersion: '0.0.2' })])),
        ),
      ),
    ],
  }),
  chatStory({
    slug: 'same-dialog-again',
    title: 'Ask, the same dialog asked again after its answer',
    shows: { text: 'Answered. Waiting for Claude to move on.' },
    ends: { selector: '[data-machine="ask-answer"][data-state="Open"]' },
    link: blocked(sameDialogAsk),
    events: LEAD_IN,
    arrange: ({ link }) =>
      Ref.set(
        link.commandAnswer,
        Exit.succeed(
          inputDelivered(new AnswerAsk({ pane: PANE, ask: SCREEN_ID, answer: new Approve() })),
        ),
      ),
    settle: () =>
      Effect.andThen(clicks('Yes'), seesText('Answered. Waiting for Claude to move on.')),
    timeline: [
      step<LinkStage>(700, 'Claude runs the command', ({ link }) =>
        SubscriptionRef.set(
          link.state,
          liveWith(
            herd([
              machine(LAPTOP, [agent('w1:p1', 'working', { title: CHAT_TITLE, seq: 2 })], {
                agentVersion: '0.0.2',
              }),
            ]),
          ),
        ),
      ),
      step<LinkStage>(1100, 'Claude asks the same thing again', ({ link }) =>
        SubscriptionRef.set(
          link.state,
          liveWith(
            herd([machine(LAPTOP, [blockedRow(sameDialogAsk, 3)], { agentVersion: '0.0.2' })]),
          ),
        ),
      ),
    ],
  }),
]
