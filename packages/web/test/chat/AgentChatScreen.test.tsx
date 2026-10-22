import { describe, expect, it } from '@effect/vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import type { AgentRow } from '@crook/domain/AgentRow'
import { PermissionAsk, RunCommand } from '@crook/domain/Ask'
import {
  AgentStarted,
  AnswerAsk,
  ClosePane,
  Decline,
  PaneClosed,
  Prompt,
  SendKeys,
} from '@crook/domain/Command'
import { HerdMachine } from '@crook/domain/HerdView'
import { AskId, PaneId } from '@crook/domain/Ids'
import { MachineState } from '@crook/domain/MachineState'
import { Pane } from '@crook/domain/Pane'
import { PaneTranscript, SubagentsChanged, SubagentTranscript } from '@crook/domain/Transcript'
import { SubagentLaunch } from '@crook/domain/TranscriptMessage'
import { PaneNotInHerd } from '@crook/protocol/ClientApi'
import { TranscriptReadFailed, TranscriptResumeRejected } from '@crook/protocol/Transcripts'
import { STOP_SETTLE } from '@crook/web/chat/ChatCommands'
import { COLD_START } from '@crook/web/rpc/HubLinkState'

import { liveWith, renderApp, stateWith } from '../AppRender.tsx'
import { click, eventually, findByRole, present, wait } from '../Dom.ts'
import { agent, CROOK_TAB, CROOK_WORKSPACE, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { inputDelivered, STARTED_PANE } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import {
  caughtUp,
  chunk,
  CWD,
  opened,
  prompt,
  REVIEWER,
  said,
  SESSION,
  subagent,
  toolResult,
  toolUse,
} from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812
const TALL_SCROLL_HEIGHT = 100_000
const MANY_LINES = 120
const LINE_BYTES = 10

const ask = new PermissionAsk({
  id: AskId.make('toolu_01XXC3'),
  source: 'hook',
  tool: 'Bash',
  plugin: Option.none(),
  action: new RunCommand({ command: 'bun run lint' }),
  options: [],
  dialog: Option.none(),
})

const laptopWith = (rows: readonly AgentRow[], options: Parameters<typeof machine>[2] = {}) =>
  machine(LAPTOP, rows, options)

const withShellPane = (entry: HerdMachine, pane: string): HerdMachine =>
  new HerdMachine(
    Struct.evolve(entry, {
      state: (state) =>
        Option.map(
          state,
          (found) =>
            new MachineState(
              Struct.evolve(found, {
                panes: (panes) => [
                  ...panes,
                  new Pane({ id: PaneId.make(pane), workspace: CROOK_WORKSPACE, tab: CROOK_TAB }),
                ],
              }),
            ),
        ),
    }),
  )

const live = (rows: readonly AgentRow[]) => liveWith(herd([laptopWith(rows)]))

const field = () => present(screen.queryByRole('textbox'), 'The composer')

const tallViewport = () => {
  const viewport = present(
    document.querySelector<HTMLElement>('[data-slot="conversation-viewport"]'),
    'The thread',
  )

  Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: TALL_SCROLL_HEIGHT })

  return viewport
}

const followedToBottom = Effect.fn('followedToBottom')(function* (viewport: HTMLElement) {
  yield* eventually(() => {
    expect(viewport.scrollTop).toBe(TALL_SCROLL_HEIGHT)
  })
  fireEvent.scroll(viewport)
})

const manyLines = (from: number) =>
  chunk(
    from,
    from + MANY_LINES * LINE_BYTES,
    Arr.makeBy(MANY_LINES, (index) => said(from + index * LINE_BYTES, `Line ${index}`)),
  )

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

describe('AgentChatScreen', () => {
  it.effect("renders your prompt, Claude's markdown and a collapsed tool call", () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 40, [
          prompt(0, 'Fix the herd screen'),
          said(10, 'Fixed it **for good**.'),
          toolUse(20, 'toolu_1', 'Read', { file_path: `${CWD}/src/Herd.ts` }),
          toolResult(30, 'toolu_1', 'export const herd = 1'),
        ]),
      ])

      const tool = yield* Effect.promise(() =>
        screen.findByRole('button', { name: /^Read\(src\/Herd\.ts\)/u }),
      )

      expect(screen.getByText('Fix the herd screen').closest('[data-role="user"]')).not.toBeNull()
      expect(screen.getByText('for good').tagName).toBe('STRONG')
      expect(tool.getAttribute('aria-expanded')).toBe('false')
      expect(screen.queryByText('export const herd = 1')).toBeNull()
    }),
  )

  it.effect('shows the image Claude read as a thumbnail that opens full screen', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 20, [
          toolUse(0, 'toolu_1', 'Read', { file_path: `${CWD}/shots/herd.png` }),
          toolResult(10, 'toolu_1', 'Read an image', { image: true }),
        ]),
      ])
      yield* click(yield* findByRole('button', 'View herd.png'))

      expect(yield* findByRole('button', 'Close image')).toBeDefined()
      expect(screen.getByRole('dialog').textContent).toContain('herd.png')
    }),
  )

  it.effect('says a pane without Claude is not a Claude pane, and offers no composer', () =>
    Effect.gen(function* () {
      yield* renderApp(
        '/m/laptop/p/w1:p5',
        liveWith(herd([withShellPane(laptopWith([agent('w1:p1', 'idle')]), 'w1:p5')])),
      )

      expect(yield* Effect.promise(() => screen.findByText('Not a Claude pane'))).toBeDefined()
      expect(screen.queryByRole('textbox')).toBeNull()
    }),
  )

  it.effect('sends a prompt once, shows it sent, and clears the draft', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: 'Run the tests' }))),
      )
      yield* Queue.offer(transcript, opened())
      yield* Effect.promise(() => userEvent.type(field(), 'Run the tests{Enter}'))
      yield* eventually(() => {
        expect(screen.getByText('Sent')).toBeDefined()
      })

      const sent = yield* Ref.get(link.sent)

      expect(sent.map((call) => call.command)).toMatchObject([
        { _tag: 'Prompt', pane: PANE, text: 'Run the tests' },
      ])
      expect(field()).toHaveProperty('value', '')

      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'working', { seq: 2 })]))
      yield* Queue.offer(transcript, chunk(0, 10, [prompt(0, 'Run the tests')]))
      yield* eventually(() => {
        expect(screen.queryByText('Sent')).toBeNull()
      })

      expect(screen.getAllByText('Run the tests')).toHaveLength(1)
      expect((yield* Ref.get(link.sent)).length).toBe(1)
    }),
  )

  it.effect('sends a slash command without leaving a bubble the transcript never answers', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: '/compact' }))),
      )
      yield* Queue.offer(transcript, opened())
      yield* Effect.promise(() => screen.findByText('No messages yet'))
      fireEvent.change(field(), { target: { value: '/compact' } })
      yield* click(yield* findByRole('button', 'Send'))
      yield* eventually(() => {
        expect(field()).toHaveProperty('value', '')
      })

      expect(Ref.getUnsafe(link.sent).map((call) => call.command)).toMatchObject([
        { _tag: 'Prompt', pane: PANE, text: '/compact' },
      ])
      expect(screen.queryByText('Sent')).toBeNull()
    }),
  )

  it.effect('turns Send into Stop while Claude works, and Stop sends Esc', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new SendKeys({ pane: PANE, keys: ['esc'] }))),
      )
      yield* click(yield* findByRole('button', 'Stop (Esc)'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((call) => call.command)).toMatchObject([
          { _tag: 'SendKeys', pane: PANE, keys: ['esc'] },
        ])
      })
    }),
  )

  it.effect('declines the ask with your message while Claude needs you', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'blocked', { ask })]))
      const composer = yield* Effect.promise(() =>
        screen.findByPlaceholderText('Or tell Claude what to do instead'),
      )

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(
          inputDelivered(
            new AnswerAsk({
              pane: PANE,
              ask: ask.id,
              answer: new Decline({ message: Option.some('Lint only the web package') }),
            }),
          ),
        ),
      )

      expect(document.querySelector('[data-slot="ask-dock"]')?.textContent).toContain(
        'bun run lint',
      )

      yield* Effect.promise(() => userEvent.type(composer, 'Lint only the web package{Enter}'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((call) => call.command)).toMatchObject([
          {
            _tag: 'AnswerAsk',
            pane: PANE,
            ask: ask.id,
            answer: { _tag: 'Decline', message: Option.some('Lint only the web package') },
          },
        ])
      })
    }),
  )

  it.effect('opens the action sheet from the header, and a close goes back to the herd', () =>
    Effect.gen(function* () {
      const { router, link } = yield* renderApp(
        '/m/laptop/p/w1%3Ap1',
        live([agent('w1:p1', 'idle', { title: 'Port the herd', createdByCrook: true })]),
      )
      const endedCards: string[] = []
      const watcher = new MutationObserver(() => {
        if (document.body.textContent.includes('This pane closed')) {
          endedCards.push('This pane closed')
        }
      })

      yield* Ref.set(link.commandAnswer, Exit.succeed(new PaneClosed({ pane: PANE })))
      yield* click(yield* findByRole('button', 'Actions for Port the herd'))
      const sheet = yield* Effect.promise(() => screen.findByRole('dialog'))

      expect(within(sheet).getByText('Port the herd')).toBeDefined()

      fireEvent.click(within(sheet).getByRole('button', { name: 'Hold to close agent' }))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((call) => call.command)).toEqual([
          new ClosePane({ pane: PANE, confirmed: false }),
        ])
      })
      watcher.observe(document.body, { childList: true, subtree: true, characterData: true })
      yield* SubscriptionRef.set(link.state, live([]))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/')
      })

      expect(yield* Effect.promise(() => screen.findByText('Pane closed'))).toBeDefined()

      watcher.disconnect()

      expect(endedCards).toEqual([])
    }),
  )

  it.effect('offers no actions once the pane has closed', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(
        CHAT,
        live([agent('w1:p1', 'idle', { title: 'Port the herd' })]),
      )

      yield* findByRole('button', 'Actions for Port the herd')
      yield* SubscriptionRef.set(link.state, live([]))
      yield* Effect.promise(() => screen.findByText('This pane closed'))

      expect(screen.queryByRole('button', { name: 'Actions for Port the herd' })).toBeNull()
    }),
  )

  it.effect('adds a line on Enter from a touch keyboard instead of sending', () =>
    Effect.gen(function* () {
      stubMediaQueries(['(prefers-reduced-motion)', '(pointer: coarse)'])

      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))

      yield* Effect.promise(() => screen.findByRole('textbox'))
      yield* Effect.promise(() => userEvent.type(field(), 'first{Enter}second'))

      expect(field()).toHaveProperty('value', 'first\nsecond')
      expect(yield* Ref.get(link.sent)).toEqual([])
    }),
  )

  it.effect('suggests slash commands for a typed slash and puts the chosen one in the field', () =>
    Effect.gen(function* () {
      yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))

      yield* Effect.promise(() => screen.findByRole('textbox'))
      yield* Effect.promise(() => userEvent.type(field(), '/c'))
      yield* click(yield* findByRole('button', '/compact'))

      expect(screen.queryByRole('button', { name: '/model' })).toBeNull()
      expect(field()).toHaveProperty('value', '/compact ')
    }),
  )

  it.effect(
    'keeps the draft under the offline card and gives it back when the machine returns',
    () =>
      Effect.gen(function* () {
        const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))

        yield* Effect.promise(() => screen.findByRole('textbox'))
        fireEvent.change(field(), { target: { value: 'half a thought' } })
        yield* SubscriptionRef.set(
          link.state,
          liveWith(herd([laptopWith([agent('w1:p1', 'idle')], { connection: 'offline' })])),
        )

        expect(
          (yield* Effect.promise(() => screen.findByText('laptop is offline'))).getAttribute(
            'role',
          ),
        ).toBe('status')
        expect(screen.getByText('Waiting for it. Last heard from 2h ago.')).toBeDefined()
        expect(screen.queryByRole('textbox')).toBeNull()
        expect(screen.getByText('laptop offline')).toBeDefined()

        yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'idle')]))

        expect(
          yield* Effect.promise(() => screen.findByDisplayValue('half a thought')),
        ).toBeDefined()
      }),
  )

  it.effect('tells a closed pane from an exited Claude and stays on the chat', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))

      yield* Effect.promise(() => screen.findByRole('textbox'))
      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([withShellPane(laptopWith([]), 'w1:p1')])),
      )

      expect(yield* Effect.promise(() => screen.findByText('Claude exited'))).toBeDefined()

      yield* SubscriptionRef.set(link.state, live([]))

      expect(yield* Effect.promise(() => screen.findByText('This pane closed'))).toBeDefined()
      expect(screen.getByText('closed')).toBeDefined()
      expect(router.state.location.pathname).toBe(CHAT)
    }),
  )

  it.effect('waits for the hub instead of calling closed a pane the cached herd lacks', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(
        CHAT,
        stateWith(COLD_START, Option.some(herd([laptopWith([])]))),
      )

      expect(
        yield* Effect.promise(() => screen.findByText('Loading the conversation')),
      ).toBeDefined()
      expect(screen.queryByText('This pane closed')).toBeNull()

      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'idle')]))

      expect(yield* Effect.promise(() => screen.findByRole('textbox'))).toBeDefined()
      expect(screen.queryByText('This pane closed')).toBeNull()
    }),
  )

  it.effect('starts Claude again in the same folder and replaces the chat in place', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))

      yield* Effect.promise(() => screen.findByRole('textbox'))
      yield* Ref.set(link.commandAnswer, Exit.succeed(new AgentStarted({ pane: STARTED_PANE })))
      yield* SubscriptionRef.set(link.state, live([]))
      yield* click(yield* findByRole('button', 'Start Claude here again'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((call) => call.command)).toMatchObject([
          { _tag: 'StartAgent', kind: 'claude', folder: CWD },
        ])
      })
      yield* SubscriptionRef.set(link.state, live([agent(STARTED_PANE, 'idle')]))
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe('/m/laptop/p/w1%3Ap9')
      })
    }),
  )

  it.effect('pushes a read-only subagent screen from its row in the tree', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 30, [
          prompt(0, 'Review the diff'),
          toolUse(10, 'toolu_1', 'Agent', {
            description: 'Review the herd diff',
            prompt: 'Read the diff and list the risks.',
            subagent_type: 'code-reviewer',
          }),
          toolResult(20, 'toolu_1', 'Async agent launched', {
            launch: new SubagentLaunch({ subagent: REVIEWER, status: 'async_launched' }),
          }),
        ]),
        new SubagentsChanged({ session: SESSION, subagents: [subagent({ toolUseId: 'toolu_1' })] }),
      ])

      expect(yield* findByRole('button', '1 running')).toBeDefined()

      yield* click(
        present(
          (yield* Effect.promise(() => screen.findByText('Review the herd diff'))).closest(
            'button',
          ),
          'The subagent row',
        ),
      )
      yield* eventually(() => {
        expect(router.state.location.pathname).toBe(
          `/m/laptop/p/w1%3Ap1/sub/${SESSION}/${REVIEWER}`,
        )
      })

      const own = yield* link.transcriptFor(
        new SubagentTranscript({ session: SESSION, subagent: REVIEWER }),
      )

      yield* Queue.offerAll(own, [opened(), chunk(0, 10, [said(0, 'Two risks found.')])])

      expect(yield* Effect.promise(() => screen.findByText('Two risks found.'))).toBeDefined()
      expect(screen.getByText('Read the diff and list the risks.')).toBeDefined()
      expect(
        screen.getByText('Subagents take no messages. Reply to Claude in its chat.'),
      ).toBeDefined()
      expect(screen.getByRole('button', { name: 'Back to Agent in w1:p1' })).toBeDefined()
    }),
  )

  it.effect('watches again once the herd shows the pane after the hub refused the watch', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const source = new PaneTranscript({ pane: PANE })

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes)).toHaveLength(1)
      })
      yield* link.endTranscript(source, new PaneNotInHerd({ machine: LAPTOP, pane: PANE }))

      expect(yield* findByRole('button', 'Try again')).toBeDefined()

      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([laptopWith([agent('w1:p1', 'idle')], { connection: 'offline' })])),
      )
      yield* Effect.promise(() => screen.findByText('laptop is offline'))
      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'idle')]))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes)).toHaveLength(2)
      })
      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(0, 10, [said(0, 'Back again.')]),
      ])

      expect(yield* Effect.promise(() => screen.findByText('Back again.'))).toBeDefined()
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    }),
  )

  it.effect('watches again when you ask it to try again', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const source = new PaneTranscript({ pane: PANE })

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes)).toHaveLength(1)
      })
      yield* link.endTranscript(source, new TranscriptReadFailed({ detail: 'disk unplugged' }))
      yield* click(yield* findByRole('button', 'Try again'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes)).toHaveLength(2)
      })
    }),
  )

  it.effect('starts over from the tail when the hub cannot resume where the chat left off', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const source = new PaneTranscript({ pane: PANE })

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(0, 10, [said(0, 'Before the file shrank.')]),
      ])
      yield* Effect.promise(() => screen.findByText('Before the file shrank.'))
      yield* link.endTranscript(source, new TranscriptResumeRejected({ detail: 'it shrank' }))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes).map((resume) => Option.isSome(resume.from))).toEqual([
          false,
          false,
        ])
      })

      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    }),
  )

  it.effect('sends one Esc for Stop while the first one may still be landing', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new SendKeys({ pane: PANE, keys: ['esc'] }))),
      )

      const stop = yield* findByRole('button', 'Stop (Esc)')

      yield* click(stop)
      yield* eventually(() => {
        expect(stop.getAttribute('aria-busy')).toBe('true')
      })
      yield* click(stop)

      expect(stop).toHaveProperty('disabled', true)
      expect(Ref.getUnsafe(link.sent)).toHaveLength(1)
    }),
  )

  it.effect('keeps a typed draft when the slash button is in reach', () =>
    Effect.gen(function* () {
      yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))

      yield* Effect.promise(() => screen.findByRole('textbox'))
      fireEvent.change(field(), { target: { value: 'first line\nsecond line' } })

      const slash = screen.getByRole('button', { name: 'Slash command' })

      yield* click(slash)

      expect(slash).toHaveProperty('disabled', true)
      expect(field()).toHaveProperty('value', 'first line\nsecond line')
    }),
  )

  it.effect('sends on Ctrl+Enter from a touch keyboard', () =>
    Effect.gen(function* () {
      stubMediaQueries(['(prefers-reduced-motion)', '(pointer: coarse)'])

      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: 'Run it' }))),
      )
      yield* Effect.promise(() => screen.findByRole('textbox'))
      yield* Effect.promise(() => userEvent.type(field(), 'Run it{Control>}{Enter}{/Control}'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((call) => call.command)).toMatchObject([
          { _tag: 'Prompt', pane: PANE, text: 'Run it' },
        ])
      })
    }),
  )

  it.effect('keeps a resent prompt as sent until the transcript holds it', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: 'continue' }))),
      )
      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'continue')])])
      yield* Effect.promise(() => screen.findByText('continue'))
      yield* Effect.promise(() => userEvent.type(field(), 'continue{Enter}'))
      yield* eventually(() => {
        expect(screen.getByText('Sent')).toBeDefined()
      })
      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'working', { seq: 2 })]))
      yield* Effect.promise(() => screen.findByRole('button', { name: 'Stop (Esc)' }))

      expect(screen.getByText('Sent')).toBeDefined()

      yield* Queue.offer(transcript, chunk(10, 20, [prompt(10, 'continue')]))
      yield* eventually(() => {
        expect(screen.queryByText('Sent')).toBeNull()
      })

      expect(screen.getAllByText('continue')).toHaveLength(2)
    }),
  )

  it.effect('keeps a second prompt as sent while only the first has arrived', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'first')])])
      yield* Effect.promise(() => screen.findByText('first'))
      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: 'second' }))),
      )
      yield* Effect.promise(() => userEvent.type(field(), 'second{Enter}'))
      yield* eventually(() => {
        expect(screen.getByText('Sent')).toBeDefined()
      })
      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: 'third' }))),
      )
      yield* Effect.promise(() => userEvent.type(field(), 'third{Enter}'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent)).toHaveLength(2)
        expect(screen.getByText('third')).toBeDefined()
      })
      yield* Queue.offer(transcript, chunk(10, 20, [prompt(10, 'second')]))
      yield* Effect.promise(() => screen.findByText('second'))

      expect(screen.getByText('Sent')).toBeDefined()

      yield* Queue.offer(transcript, chunk(20, 30, [prompt(20, 'third')]))
      yield* eventually(() => {
        expect(screen.queryByText('Sent')).toBeNull()
      })
    }),
  )

  it.effect('names the machine on Back when the chat was opened from it', () =>
    Effect.gen(function* () {
      yield* renderApp(
        '/machines/laptop',
        live([agent('w1:p1', 'idle', { title: 'Port the herd' })]),
      )

      yield* click(yield* Effect.promise(() => screen.findByText('Port the herd')))

      expect(yield* findByRole('button', 'Back to laptop')).toBeDefined()
    }),
  )

  it.effect('keeps the image open while the live tail pushes its card out of the thread', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 20, [
          toolUse(0, 'toolu_1', 'Read', { file_path: `${CWD}/shots/herd.png` }),
          toolResult(10, 'toolu_1', 'Read an image', { image: true }),
        ]),
      ])
      yield* click(yield* findByRole('button', 'View herd.png'))
      yield* findByRole('button', 'Close image')

      const viewport = tallViewport()

      yield* Queue.offer(transcript, manyLines(20))
      yield* followedToBottom(viewport)
      yield* eventually(() => {
        expect(document.querySelector('[aria-label="View herd.png"]')).toBeNull()
      })

      expect(screen.getByRole('dialog').textContent).toContain('herd.png')
      expect(screen.getByRole('button', { name: 'Close image' })).toBeDefined()
    }),
  )

  it.effect('keeps a tool call open after it scrolls out of the thread and back', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 20, [
          toolUse(0, 'toolu_1', 'Read', { file_path: `${CWD}/src/Herd.ts` }),
          toolResult(10, 'toolu_1', 'export const herd = 1'),
        ]),
      ])
      yield* click(yield* Effect.promise(() => screen.findByRole('button', { name: /^Read\(/u })))

      const viewport = tallViewport()

      yield* Queue.offer(transcript, manyLines(20))
      yield* followedToBottom(viewport)
      yield* eventually(() => {
        expect(screen.queryByRole('button', { name: /^Read\(/u })).toBeNull()
      })
      viewport.scrollTop = 0
      fireEvent.scroll(viewport)

      const tool = yield* Effect.promise(() => screen.findByRole('button', { name: /^Read\(/u }))

      expect(tool.getAttribute('aria-expanded')).toBe('true')
    }),
  )

  it.effect('shows no Sent bubble again once its prompt arrived and the thread reloads', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const source = new PaneTranscript({ pane: PANE })
      const transcript = yield* link.transcriptFor(source)

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: 'second' }))),
      )
      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'first')])])
      yield* Effect.promise(() => screen.findByText('first'))
      yield* Effect.promise(() => userEvent.type(field(), 'second{Enter}'))
      yield* eventually(() => {
        expect(screen.getByText('Sent')).toBeDefined()
      })
      yield* Queue.offer(transcript, chunk(10, 20, [prompt(10, 'second')]))
      yield* eventually(() => {
        expect(screen.queryByText('Sent')).toBeNull()
      })
      yield* link.endTranscript(source, new TranscriptResumeRejected({ detail: 'it shrank' }))
      yield* Queue.offer(yield* link.transcriptFor(source), opened())
      yield* Effect.promise(() => screen.findByText('No messages yet'))

      expect(screen.queryByText('Sent')).toBeNull()
    }),
  )

  it.effect('lets Stop send another Esc when the first one did not stop Claude', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new SendKeys({ pane: PANE, keys: ['esc'] }))),
      )

      const stop = yield* findByRole('button', 'Stop (Esc)')

      yield* click(stop)
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent)).toHaveLength(1)
      })
      yield* wait(Duration.toMillis(STOP_SETTLE))
      yield* eventually(() => {
        expect(stop).toHaveProperty('disabled', false)
      })
      yield* click(stop)
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.sent).map((call) => call.command)).toMatchObject([
          { _tag: 'SendKeys', keys: ['esc'] },
          { _tag: 'SendKeys', keys: ['esc'] },
        ])
      })
    }),
  )
})

describe('AgentChatScreen loading', () => {
  const current = () =>
    liveWith(
      herd([
        laptopWith([agent('w1:p1', 'idle', { claudeSession: SESSION })], { agentVersion: '0.0.1' }),
      ]),
    )
  const source = new PaneTranscript({ pane: PANE })

  it.effect('shows a skeleton until the agent has sent the backlog, then all of it at once', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, current())
      const transcript = yield* link.transcriptFor(source)

      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [said(0, 'Older line.')])])
      yield* wait(50)

      expect(screen.getByText('Loading the conversation')).toBeDefined()
      expect(screen.queryByText('Older line.')).toBeNull()

      yield* Queue.offerAll(transcript, [chunk(10, 20, [said(10, 'Newer line.')]), caughtUp(20)])
      yield* Effect.promise(() => screen.findByText('Newer line.'))

      expect(screen.getByText('Older line.')).toBeDefined()
      expect(screen.queryByText('Loading the conversation')).toBeNull()

      yield* Queue.offer(transcript, chunk(20, 30, [said(20, 'Live line.')]))

      expect(yield* Effect.promise(() => screen.findByText('Live line.'))).toBeDefined()
    }),
  )

  it.effect(
    'streams every chunk from an agent older than the hub, which never says it caught up',
    () =>
      Effect.gen(function* () {
        const { link } = yield* renderApp(
          CHAT,
          liveWith(herd([laptopWith([agent('w1:p1', 'idle')], { agentVersion: '0.0.0' })])),
        )

        yield* Queue.offerAll(yield* link.transcriptFor(source), [
          opened(),
          chunk(0, 10, [said(0, 'Older line.')]),
        ])

        expect(yield* Effect.promise(() => screen.findByText('Older line.'))).toBeDefined()
      }),
  )

  it.effect('opens a chat again where it left off, and shows the rest once it caught up', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp(CHAT, current())

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(0, 10, [said(0, 'Seen before.')]),
        caughtUp(10),
      ])
      yield* Effect.promise(() => screen.findByText('Seen before.'))
      yield* Effect.promise(() => router.navigate({ to: '/' }))
      yield* eventually(() => {
        expect(screen.queryByText('Seen before.')).toBeNull()
      })
      yield* Effect.promise(() =>
        router.navigate({ to: '/m/$machine/p/$pane', params: { machine: LAPTOP, pane: PANE } }),
      )

      expect(yield* Effect.promise(() => screen.findByText('Seen before.'))).toBeDefined()
      expect(screen.queryByText('Loading the conversation')).toBeNull()

      yield* eventually(() => {
        expect(
          Ref.getUnsafe(link.resumes).map((resume) =>
            Option.map(resume.from, (position) => position.offset),
          ),
        ).toEqual([Option.none(), Option.some(10)])
      })

      const resumed = yield* link.transcriptFor(source)

      yield* Queue.offerAll(resumed, [opened(), chunk(10, 20, [said(10, 'Missed while away.')])])
      yield* wait(50)

      expect(screen.queryByText('Missed while away.')).toBeNull()
      expect(screen.getByText('Seen before.')).toBeDefined()

      yield* Queue.offer(resumed, caughtUp(20))

      expect(yield* Effect.promise(() => screen.findByText('Missed while away.'))).toBeDefined()
    }),
  )

  it.effect('saves the chat on this device once the agent caught up', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, current())

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(0, 10, [said(0, 'Kept for later.')]),
        caughtUp(10),
      ])
      yield* eventually(() => {
        expect(
          Array.from(Ref.getUnsafe(link.storedTranscripts).values(), (entry) => entry.key),
        ).toEqual([[LAPTOP, 'pane', PANE, SESSION]])
      })
    }),
  )
})
