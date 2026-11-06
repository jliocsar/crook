import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import { Prompt } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'
import type { AgentRow } from '@crook/domain/AgentRow'
import { COMMAND_SILENCE } from '@crook/web/chat/ChatCommands'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole, present, wait } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { inputDelivered } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import {
  answered,
  caughtUp,
  chunk,
  compactBoundary,
  compactSummary,
  opened,
  prompt,
} from '../TranscriptFixtures.ts'
import { messagesOf } from '../../stories/RealTranscriptFixtures.ts'

const SHORTENED_SILENCE_MS = 40
const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812

const live = (rows: readonly AgentRow[]) => liveWith(herd([machine(LAPTOP, rows)]))

const field = () => present(screen.queryByRole('textbox'), 'The composer')

const shortensTheSilence = () => {
  const realSetTimeout = globalThis.setTimeout

  vi.spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay) =>
    // oxlint-disable-next-line effecttsgo/global-timers
    realSetTimeout(
      handler,
      delay === Duration.toMillis(COMMAND_SILENCE) ? SHORTENED_SILENCE_MS : delay,
    ),
  )
}

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

describe('a slash send', () => {
  it.effect('refuses a bare picker inline and says it needs the laptop, sending nothing', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [opened(), caughtUp(0)])
      yield* Effect.promise(() => screen.findByText('No messages yet'))
      fireEvent.change(field(), { target: { value: '/model' } })

      expect(screen.queryByText(/needs the laptop/u)).toBeNull()

      yield* click(yield* findByRole('button', 'Send'))
      yield* Effect.promise(() =>
        screen.findByText(/\/model opens a dialog, so it needs the laptop/u),
      )

      expect(field()).toHaveProperty('value', '/model')
      expect(Ref.getUnsafe(link.sent)).toEqual([])

      fireEvent.change(field(), { target: { value: '/resume' } })
      yield* eventually(() => {
        expect(screen.queryByText(/needs the laptop/u)).toBeNull()
      })

      fireEvent.change(field(), { target: { value: '/model' } })

      expect(screen.queryByText(/needs the laptop/u)).toBeNull()

      yield* click(yield* findByRole('button', 'Send'))
      yield* Effect.promise(() => screen.findByText(/\/model opens a dialog/u))
      fireEvent.change(field(), { target: { value: '/model opus' } })
      yield* eventually(() => {
        expect(screen.queryByText(/needs the laptop/u)).toBeNull()
      })
    }),
  )

  it.effect('shows a slash send as Sent until its command lands, as one row', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: '/compact' }))),
      )
      yield* Queue.offerAll(transcript, [opened(), caughtUp(0)])
      yield* Effect.promise(() => screen.findByText('No messages yet'))
      fireEvent.change(field(), { target: { value: '/compact' } })
      yield* click(yield* findByRole('button', 'Send'))
      yield* eventually(() => {
        expect(field()).toHaveProperty('value', '')
      })

      expect(Ref.getUnsafe(link.sent).map((call) => call.command)).toMatchObject([
        { _tag: 'Prompt', pane: PANE, text: '/compact' },
      ])

      yield* Effect.promise(() => screen.findByText('Sent'))
      yield* Queue.offer(
        transcript,
        chunk(0, 10, [compactBoundary(0), compactSummary(5, 'Short.')]),
      )
      yield* eventually(() => {
        expect(screen.queryByText('Sent')).toBeNull()
      })

      expect(screen.getByText('Conversation compacted')).toBeDefined()
      expect(document.querySelector('[data-slot="command"]')).toBeNull()
    }),
  )

  it.effect('ends a Sent row nothing answers and says why, until an answer lands', () =>
    Effect.gen(function* () {
      shortensTheSilence()

      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: '/login' }))),
      )
      yield* Queue.offerAll(transcript, [opened(), caughtUp(0)])
      yield* Effect.promise(() => screen.findByText('No messages yet'))
      fireEvent.change(field(), { target: { value: '/login' } })
      yield* click(yield* findByRole('button', 'Send'))
      yield* Effect.promise(() => screen.findByText(/No answer to \/login/u))

      expect(screen.queryByText('Sent')).toBeNull()

      yield* Queue.offer(
        transcript,
        chunk(
          0,
          10,
          messagesOf('{"type":"user","message":{"content":"<command-name>/login</command-name>"}}'),
        ),
      )
      yield* eventually(() => {
        expect(screen.queryByText(/No answer to/u)).toBeNull()
      })

      expect(screen.getByText('/login')).toBeDefined()
    }),
  )

  it.effect('gives a command sent twice its bound again from the second send', () =>
    Effect.gen(function* () {
      const timers = vi.spyOn(globalThis, 'setTimeout')
      const silences = () =>
        timers.mock.calls.filter(([, delay]) => delay === Duration.toMillis(COMMAND_SILENCE)).length
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'idle')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: '/login' }))),
      )
      yield* Queue.offerAll(transcript, [opened(), caughtUp(0)])
      yield* Effect.promise(() => screen.findByText('No messages yet'))
      fireEvent.change(field(), { target: { value: '/login' } })
      yield* click(yield* findByRole('button', 'Send'))
      yield* Effect.promise(() => screen.findByText('Sent'))
      yield* eventually(() => {
        expect(silences()).toBe(1)
      })
      fireEvent.change(field(), { target: { value: '/login' } })
      yield* click(yield* findByRole('button', 'Send'))
      yield* eventually(() => {
        expect(screen.getByText('Queued')).toBeDefined()
        expect(silences()).toBe(2)
      })
    }),
  )

  it.effect('gives a command queued in a turn its bound only once the turn is over', () =>
    Effect.gen(function* () {
      shortensTheSilence()

      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: '/effort high' }))),
      )
      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'Run the tests')])])
      yield* Effect.promise(() => screen.findByText('Run the tests'))
      fireEvent.change(field(), { target: { value: '/effort high' } })
      yield* click(yield* findByRole('button', 'Send'))
      yield* Effect.promise(() => screen.findByText('Queued'))
      yield* wait(SHORTENED_SILENCE_MS * 4)

      expect(screen.getByText('Queued')).toBeDefined()
      expect(screen.queryByText(/No answer to/u)).toBeNull()

      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'idle', { seq: 2 })]))
      yield* Queue.offer(transcript, chunk(10, 20, [answered(10, 'Done.', 600)]))
      yield* Effect.promise(() => screen.findByText(/No answer to \/effort high/u))

      expect(screen.queryByText('Queued')).toBeNull()
    }),
  )
})
