import { describe, expect, it } from '@effect/vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Struct from 'effect/Struct'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import type { AgentRow } from '@crook/domain/AgentRow'
import { PermissionAsk, RunCommand } from '@crook/domain/Ask'
import { HerdMachine } from '@crook/domain/HerdView'
import { AskId, PaneId } from '@crook/domain/Ids'
import { MachineState } from '@crook/domain/MachineState'
import { Pane } from '@crook/domain/Pane'
import { PaneTranscript, SubagentsChanged, SubagentTranscript } from '@crook/domain/Transcript'
import { SubagentLaunch } from '@crook/domain/TranscriptMessage'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole, present } from '../Dom.ts'
import { agent, CROOK_TAB, CROOK_WORKSPACE, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { STARTED_PANE } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import {
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

  it.effect('turns Send into Stop while Claude works, and Stop sends Esc', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))

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

      expect(document.querySelector('[data-slot="ask-dock"]')?.textContent).toContain(
        'Bash bun run lint',
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

  it.effect('starts Claude again in the same folder and replaces the chat in place', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))

      yield* Effect.promise(() => screen.findByRole('textbox'))
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
})
