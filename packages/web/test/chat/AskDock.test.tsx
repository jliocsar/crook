import { describe, expect, it } from '@effect/vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import type { AgentRow } from '@crook/domain/AgentRow'
import {
  AskOption,
  AskQuestion,
  EditFile,
  PermissionAsk,
  QuestionAsk,
  QuestionChoice,
  RunCommand,
  UnknownAsk,
} from '@crook/domain/Ask'
import type { AskChoice } from '@crook/domain/Ask'
import { AnswerAsk, Approve, ApproveAlways, Choose, Decline, Prompt } from '@crook/domain/Command'
import type { AskAnswer } from '@crook/domain/Command'
import { AskId, PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'
import { PatchHunk } from '@crook/domain/TranscriptMessage'
import {
  AskDialogUnreadable,
  AskNotPending,
  DeclineMessageUndelivered,
} from '@crook/protocol/Commands'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { inputDelivered } from '../HubFakes.ts'
import type { SentCommand } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import {
  chunk,
  CWD,
  NEXT_SESSION,
  opened,
  prompt,
  toolResult,
  toolUse,
} from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const BASH_ID = AskId.make('toolu_bash')
const EDIT_ID = AskId.make('toolu_edit')
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812

const ALWAYS_LABEL =
  "Yes, and don't ask again for bun run lint commands in /home/jliocsar/Projects/crook"

const EDIT_ALWAYS_LABEL =
  'Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)'

const EDIT_NOTE = 'File edits like this one allowed for the rest of the session'

const dialogOptions = (labels: readonly (readonly [string, AskChoice])[]) =>
  labels.map(([label, choice], index) => new AskOption({ number: index + 1, label, choice }))

const THREE_OPTIONS = dialogOptions([
  ['Yes', 'yes'],
  [ALWAYS_LABEL, 'always'],
  ['No, and tell Claude what to do differently (esc)', 'no'],
])

const bashAsk = (options: readonly AskOption[] = THREE_OPTIONS) =>
  new PermissionAsk({
    id: BASH_ID,
    source: 'hook',
    tool: 'Bash',
    plugin: Option.none(),
    action: new RunCommand({ command: 'bun run lint' }),
    options,
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
  options: dialogOptions([
    ['Yes', 'yes'],
    [EDIT_ALWAYS_LABEL, 'always'],
    ['No', 'no'],
  ]),
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
        () =>
          new AskQuestion({
            header: 'Port',
            question: 'Which port?',
            multiSelect,
            choices: [new QuestionChoice({ label: '8080', description: Option.none() })],
          }),
      ),
    ],
    dialog: Option.some('fingerprint'),
  })

const live = (rows: readonly AgentRow[]) => liveWith(herd([machine(LAPTOP, rows)]))

const blockedOn = (ask: PermissionAsk | QuestionAsk | UnknownAsk) =>
  live([agent('w1:p1', 'blocked', { ask, title: 'Lint the web package' })])

const dock = () => {
  const found = document.querySelector<HTMLElement>('[data-slot="ask-dock"]')

  if (found === null) {
    throw new Error('The ask dock is not on the page.')
  }

  return found
}

const answerLabels = () =>
  Array.from(
    dock().querySelectorAll('[data-slot="ask-answers"] button'),
    (button) => button.textContent,
  )

const answered = (answer: AskAnswer, ask = BASH_ID) => new AnswerAsk({ pane: PANE, ask, answer })

const sentCommands = (link: { readonly sent: Ref.Ref<readonly SentCommand[]> }) =>
  Ref.getUnsafe(link.sent).map((call) => call.command)

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(DateTime.addDuration(START, Duration.minutes(5)).epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the ask dock', () => {
  it.effect('shows a command ask with Yes, Always and No, and answers it once', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, blockedOn(bashAsk()))
      const yes = yield* findByRole('button', 'Yes')

      expect(within(dock()).getByText('Run this command?')).toBeDefined()
      expect(within(dock()).getByText('Bash')).toBeDefined()
      expect(within(dock()).getByText('bun run lint')).toBeDefined()
      expect(answerLabels()).toEqual(expect.arrayContaining(['Yes', 'Always', 'No']))
      expect(
        within(dock()).getByText(
          "Always: don't ask again for bun run lint commands in /home/jliocsar/Projects/crook",
        ),
      ).toBeDefined()

      yield* link.commandAnswers.close
      yield* Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(answered(new Approve()))))
      yield* click(yes)
      yield* eventually(() => {
        expect(screen.getByRole('button', { name: 'No' })).toHaveProperty('disabled', true)
      })

      expect(sentCommands(link)).toEqual([answered(new Approve())])

      yield* link.commandAnswers.open
      yield* Effect.promise(() => screen.findByText('Answered. Waiting for Claude to move on.'))

      expect(screen.getByRole('button', { name: 'No' })).toHaveProperty('disabled', false)

      yield* SubscriptionRef.set(
        link.state,
        live([agent('w1:p1', 'working', { seq: 2, title: 'Lint the web package' })]),
      )
      yield* eventually(() => {
        expect(document.querySelector('[data-slot="ask-dock"]')).toBeNull()
      })

      expect(Ref.getUnsafe(link.sent)).toHaveLength(1)
    }),
  )

  it.effect('offers only the answers the dialog shows, and always lets you decline', () =>
    Effect.gen(function* () {
      yield* renderApp(
        CHAT,
        blockedOn(
          bashAsk(
            dialogOptions([
              ['Yes', 'yes'],
              ['No', 'no'],
            ]),
          ),
        ),
      )
      yield* findByRole('button', 'Yes')

      expect(answerLabels()).toEqual(['Yes', 'No'])
    }),
  )

  it.effect('declines with Esc when the dialog could not be read', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, blockedOn(bashAsk([])))
      const no = yield* findByRole('button', 'No')
      const declined = answered(new Decline({ message: Option.none() }))

      expect(screen.queryByRole('button', { name: 'Yes' })).toBeNull()

      yield* Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(declined)))
      yield* click(no)
      yield* eventually(() => {
        expect(sentCommands(link)).toEqual([declined])
      })
    }),
  )

  it.effect('reads an ask the agent no longer shows as already answered', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, blockedOn(bashAsk()))

      yield* Ref.set(link.commandAnswer, Exit.fail(new AskNotPending({ pane: PANE, ask: BASH_ID })))
      yield* click(yield* findByRole('button', 'Yes'))

      expect(yield* Effect.promise(() => screen.findByText('Already answered'))).toBeDefined()
      expect(screen.queryByRole('alert')).toBeNull()
    }),
  )

  it.effect('says why an answer was refused and retries it under the same key', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, blockedOn(bashAsk()))
      const refusal = new AskDialogUnreadable({ pane: PANE })

      yield* Ref.set(link.commandAnswer, Exit.fail(refusal))
      yield* click(yield* findByRole('button', 'Always'))
      yield* Effect.promise(() => screen.findByText(refusal.message))
      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(answered(new ApproveAlways()))),
      )
      yield* click(screen.getByRole('button', { name: 'Always' }))
      yield* Effect.promise(() => screen.findByText('Answered. Waiting for Claude to move on.'))

      const [first, retry] = Ref.getUnsafe(link.sent)

      expect(retry?.key).toBe(first?.key)
      expect(retry?.command).toEqual(answered(new ApproveAlways()))
    }),
  )

  it.effect('takes a second tap on an ask still open after the answer, under a new key', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, blockedOn(bashAsk()))

      yield* Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(answered(new Approve()))))
      yield* click(yield* findByRole('button', 'Yes'))
      yield* Effect.promise(() => screen.findByText('Answered. Waiting for Claude to move on.'))

      expect(screen.getByRole('textbox')).toHaveProperty('disabled', false)

      yield* Ref.set(link.commandAnswer, Exit.fail(new AskNotPending({ pane: PANE, ask: BASH_ID })))
      yield* click(screen.getByRole('button', { name: 'Yes' }))
      yield* Effect.promise(() => screen.findByText('Already answered'))

      const [first, second] = Ref.getUnsafe(link.sent)

      expect(second?.command).toEqual(answered(new Approve()))
      expect(second?.key).not.toBe(first?.key)
    }),
  )

  it.effect(
    'keeps a typed answer whose message went undelivered after the ask closed, and sends it as a prompt',
    () =>
      Effect.gen(function* () {
        const ask = question(Option.some(false))
        const { link } = yield* renderApp(CHAT, blockedOn(ask))
        const refusal = new DeclineMessageUndelivered({
          pane: PANE,
          reason: 'herdr did not confirm the prompt in time',
        })
        const resent = new Prompt({ pane: PANE, text: 'Use both' })

        yield* link.commandAnswers.close
        const other = yield* Effect.promise(() => screen.findByPlaceholderText('Something else…'))

        yield* Effect.promise(() => userEvent.type(other, 'Use both'))
        yield* click(screen.getByRole('button', { name: 'Answer' }))
        yield* eventually(() => {
          expect(Ref.getUnsafe(link.sent)).toHaveLength(1)
        })
        yield* SubscriptionRef.set(
          link.state,
          live([agent('w1:p1', 'working', { seq: 2, title: 'Lint the web package' })]),
        )
        yield* eventually(() => {
          expect(document.querySelector('[data-slot="ask-dock"]')).toBeNull()
        })
        yield* Ref.set(link.commandAnswer, Exit.fail(refusal))
        yield* link.commandAnswers.open
        yield* Effect.promise(() => screen.findByText(refusal.message))

        expect(screen.getByRole('textbox')).toHaveProperty('value', 'Use both')

        yield* Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(resent)))
        yield* click(screen.getByRole('button', { name: 'Send' }))
        yield* eventually(() => {
          expect(Ref.getUnsafe(link.sent)).toHaveLength(2)
        })

        const [first, retry] = Ref.getUnsafe(link.sent)

        expect(first?.command).toEqual(
          answered(new Decline({ message: Option.some('Use both') }), ask.id),
        )
        expect(retry?.command).toEqual(resent)
        expect(retry?.key).not.toBe(first?.key)
      }),
  )

  it.effect('announces the ask, and hands keyboard focus to the composer when it clears', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, blockedOn(bashAsk()))
      const no = yield* findByRole('button', 'No')

      expect(
        Array.from(document.querySelectorAll('[role="status"]'), (region) => region.textContent),
      ).toContain('Needs you: Run this command? (Bash)')

      no.focus()
      yield* SubscriptionRef.set(
        link.state,
        live([agent('w1:p1', 'working', { seq: 2, title: 'Lint the web package' })]),
      )
      yield* eventually(() => {
        expect(document.activeElement).toBe(screen.getByRole('textbox'))
      })
    }),
  )

  it.effect('shows an edit as its diff and hides the call it asks about until it is answered', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, blockedOn(editAsk))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 20, [
          prompt(0, 'Bump the herd'),
          toolUse(10, 'toolu_edit', 'Edit', {
            file_path: `${CWD}/packages/hub/src/Herd.ts`,
            old_string: 'const herd = 1',
            new_string: 'const herd = 2',
          }),
        ]),
      ])
      yield* Effect.promise(() => screen.findByText('Bump the herd'))

      expect(within(dock()).getByText('Edit Herd.ts?')).toBeDefined()
      expect(within(dock()).getByText('packages/hub/src/Herd.ts')).toBeDefined()
      expect(within(dock()).getByText('const herd = 2')).toBeDefined()
      expect(screen.queryByRole('button', { name: /^Edit\(/u })).toBeNull()

      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'working', { seq: 2 })]))

      expect(
        yield* Effect.promise(() =>
          screen.findByRole('button', { name: /^Edit\(packages\/hub\/src\/Herd\.ts\)/u }),
        ),
      ).toBeDefined()
    }),
  )

  it.effect(
    'keeps the asked call in the thread and announces nothing once the machine is offline',
    () =>
      Effect.gen(function* () {
        const { link } = yield* renderApp(CHAT, blockedOn(editAsk))
        const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

        yield* Queue.offerAll(transcript, [
          opened(),
          chunk(0, 20, [
            prompt(0, 'Bump the herd'),
            toolUse(10, 'toolu_edit', 'Edit', {
              file_path: `${CWD}/packages/hub/src/Herd.ts`,
              old_string: 'const herd = 1',
              new_string: 'const herd = 2',
            }),
          ]),
        ])
        yield* Effect.promise(() => screen.findByText('Bump the herd'))
        yield* SubscriptionRef.set(
          link.state,
          liveWith(
            herd([
              machine(
                LAPTOP,
                [agent('w1:p1', 'blocked', { ask: editAsk, title: 'Lint the web package' })],
                { connection: 'offline' },
              ),
            ]),
          ),
        )
        yield* Effect.promise(() => screen.findByText('laptop is offline'))
        yield* eventually(() => {
          expect(document.querySelector('[data-slot="ask-dock"]')).toBeNull()
        })

        expect(
          screen.getByRole('button', { name: /^Edit\(packages\/hub\/src\/Herd\.ts\)/u }),
        ).toBeDefined()
        expect(
          Array.from(document.querySelectorAll('[role="status"]'), (region) => region.textContent),
        ).not.toContain('Needs you: Edit Herd.ts? (Edit)')
        expect(screen.queryByText(/^Needs you:/u)).toBeNull()
      }),
  )

  it.effect('leaves a note in the transcript after Always, beside the call it allowed', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, blockedOn(editAsk))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))
      const always = answered(new ApproveAlways(), EDIT_ID)

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 10, [
          toolUse(0, 'toolu_edit', 'Edit', {
            file_path: `${CWD}/packages/hub/src/Herd.ts`,
            old_string: 'const herd = 1',
            new_string: 'const herd = 2',
          }),
          toolUse(5, 'toolu_read', 'Read', { file_path: `${CWD}/packages/hub/src/Herd.ts` }),
        ]),
      ])
      yield* Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(always)))
      yield* click(yield* findByRole('button', 'Always'))

      const waiting = yield* Effect.promise(() => screen.findByText(EDIT_NOTE))
      const read = screen.getByRole('button', { name: /^Read\(/u })

      expect(waiting.compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'working', { seq: 2 })]))
      yield* Queue.offer(
        transcript,
        chunk(10, 30, [
          toolResult(10, 'toolu_edit', 'The file was updated'),
          prompt(20, 'Now run the tests'),
        ]),
      )
      yield* Effect.promise(() => screen.findByText('Now run the tests'))

      const note = screen.getByText(EDIT_NOTE)
      const call = screen.getByRole('button', { name: /^Edit\(/u })
      const later = screen.getByRole('button', { name: /^Read\(/u })

      expect(call.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(note.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }),
  )

  it.effect('drops an Always note with the session it belonged to', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, blockedOn(editAsk))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 10, [
          toolUse(0, 'toolu_edit', 'Edit', {
            file_path: `${CWD}/packages/hub/src/Herd.ts`,
            old_string: 'const herd = 1',
            new_string: 'const herd = 2',
          }),
        ]),
      ])
      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(answered(new ApproveAlways(), EDIT_ID))),
      )
      yield* click(yield* findByRole('button', 'Always'))
      yield* Effect.promise(() => screen.findByText(EDIT_NOTE))
      yield* Queue.offerAll(transcript, [
        opened(NEXT_SESSION),
        chunk(0, 10, [prompt(0, 'A fresh start.')], NEXT_SESSION),
      ])
      yield* Effect.promise(() => screen.findByText('A fresh start.'))

      expect(screen.queryByText(EDIT_NOTE)).toBeNull()
    }),
  )

  it.effect('answers a single question with the picked choice', () =>
    Effect.gen(function* () {
      const ask = question(Option.some(false))
      const { link } = yield* renderApp(CHAT, blockedOn(ask))
      const chosen = answered(new Choose({ answer: 'Token' }), ask.id)

      yield* Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(chosen)))
      yield* eventually(() => {
        expect(within(dock()).getByText('Which login should the hub use?')).toBeDefined()
      })
      fireEvent.click(screen.getByRole('radio', { name: 'Token' }))
      yield* click(screen.getByRole('button', { name: 'Answer' }))
      yield* eventually(() => {
        expect(sentCommands(link)).toEqual([chosen])
      })
    }),
  )

  it.effect('declines a question with what you typed as something else', () =>
    Effect.gen(function* () {
      const ask = question(Option.some(false))
      const { link } = yield* renderApp(CHAT, blockedOn(ask))
      const typed = answered(new Decline({ message: Option.some('Use both') }), ask.id)

      yield* Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(typed)))
      const other = yield* Effect.promise(() => screen.findByPlaceholderText('Something else…'))

      yield* Effect.promise(() => userEvent.type(other, 'Use both'))
      yield* click(screen.getByRole('button', { name: 'Answer' }))
      yield* eventually(() => {
        expect(sentCommands(link)).toEqual([typed])
      })
    }),
  )

  it.effect('shows a questionnaire crook cannot answer, with a plain decline', () =>
    Effect.gen(function* () {
      yield* renderApp(CHAT, blockedOn(question(Option.some(false), 2)))
      yield* eventually(() => {
        expect(within(dock()).getByText('Which port?')).toBeDefined()
      })

      expect(screen.queryByRole('radio')).toBeNull()
      expect(answerLabels()).toEqual(['Decline'])
    }),
  )

  it.effect('shows the raw screen of an ask crook cannot read, with a plain decline', () =>
    Effect.gen(function* () {
      const ask = new UnknownAsk({
        id: AskId.make('blocked-term-1'),
        screen: 'Pick a theme\n> Dark',
      })
      const { link } = yield* renderApp(CHAT, blockedOn(ask))
      const declined = answered(new Decline({ message: Option.none() }), ask.id)

      yield* Ref.set(link.commandAnswer, Exit.succeed(inputDelivered(declined)))
      yield* click(yield* findByRole('button', 'Decline'))

      expect(within(dock()).getByText(/Pick a theme/u)).toBeDefined()

      yield* eventually(() => {
        expect(sentCommands(link)).toEqual([declined])
      })
    }),
  )

  it.effect('holds the composer while an answer from the dock is out', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, blockedOn(bashAsk()))

      yield* link.commandAnswers.close
      yield* click(yield* findByRole('button', 'Yes'))
      yield* eventually(() => {
        expect(screen.getByRole('textbox')).toHaveProperty('disabled', true)
      })
      yield* link.commandAnswers.open
    }),
  )
})
