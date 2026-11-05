import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, vi } from 'vitest'

import type { AgentRow } from '@crook/domain/AgentRow'
import { Prompt } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript, SubagentsChanged, SubagentTranscript } from '@crook/domain/Transcript'
import { SubagentLaunch } from '@crook/domain/TranscriptMessage'
import { TranscriptReadFailed } from '@crook/protocol/Transcripts'

import { liveWith, renderApp } from '../AppRender.tsx'
import { eventually, findByRole, present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { inputDelivered } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { phoneViewport } from '../ThreadRender.tsx'
import {
  answered,
  caughtUp,
  chunk,
  compactBoundary,
  opened,
  prompt,
  REVIEWER,
  SESSION,
  subagent,
  toolResult,
  toolUse,
} from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const SUBAGENT = `/m/laptop/p/w1:p1/sub/${SESSION}/${REVIEWER}`
const WORKING_ROW = { selector: '[data-slot="thinking-state-label"]' }
const WORKING_ELAPSED = { selector: '[data-slot="thinking-state-elapsed"]' }
const ROW_ELEMENT = '[data-row="working"]'
const STOP = 'Stop (Esc)'
const SEND = 'Send'

const live = (rows: readonly AgentRow[]) => liveWith(herd([machine(LAPTOP, rows)]))

const activityState = () =>
  document.querySelector('[data-machine="activity"]')?.getAttribute('data-state')

const activityLine = () => document.querySelector('[data-machine="activity"]')?.textContent

const lastRow = () => Array.from(document.querySelectorAll(ROW_ELEMENT)).at(-1)

const field = () => screen.getByRole('textbox', { name: /Claude/u })

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  phoneViewport()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(DateTime.addDuration(START, Duration.minutes(5)).epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the Working row', () => {
  it.effect(
    'keeps the row, Stop and the word until the answer lands when herdr goes idle first',
    () =>
      Effect.gen(function* () {
        const { link } = yield* renderApp(
          CHAT,
          live([agent('w1:p1', 'working', { secondsAgo: 120 })]),
        )
        const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

        yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'Fix the herd')])])
        yield* Effect.promise(() => screen.findByText('Fix the herd'))
        yield* Effect.promise(() => screen.findByText('Working', WORKING_ROW))
        yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'idle', { seq: 2 })]))
        yield* eventually(() => {
          expect(activityState()).toBe('Holding')
        })

        expect(screen.getByText('Working', WORKING_ROW)).toBeDefined()
        expect(screen.getByText('7m', WORKING_ELAPSED)).toBeDefined()
        expect(screen.getByRole('button', { name: STOP })).toBeDefined()
        expect(screen.queryByRole('button', { name: SEND })).toBeNull()
        expect(activityLine()).toContain('working')

        yield* Queue.offer(transcript, chunk(10, 20, [answered(10, 'Fixed the herd', 5)]))
        yield* Effect.promise(() => screen.findByText('Fixed the herd'))
        yield* findByRole('button', SEND)

        expect(screen.queryByText('Working', WORKING_ROW)).toBeNull()
        expect(activityState()).toBe('Still')
      }),
  )

  it.effect('drops the row and Stop with the answer while herdr still says Claude works', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'Fix the herd')])])
      yield* Effect.promise(() => screen.findByText('Fix the herd'))
      yield* Effect.promise(() => screen.findByText('Working', WORKING_ROW))
      yield* Queue.offer(transcript, chunk(10, 20, [answered(10, 'Fixed the herd', 5)]))
      yield* Effect.promise(() => screen.findByText('Fixed the herd'))

      expect(screen.queryByText('Working', WORKING_ROW)).toBeNull()
      expect(screen.queryByRole('button', { name: STOP })).toBeNull()
      expect(screen.getByRole('button', { name: SEND })).toBeDefined()
      expect(activityState()).toBe('Finished')
    }),
  )

  it.effect('lets the Working row go with herdr when the work left nothing in the transcript', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 20, [prompt(0, 'Fix the herd'), answered(10, 'Fixed the herd')]),
      ])
      yield* Effect.promise(() => screen.findByText('Fixed the herd'))
      yield* Effect.promise(() => screen.findByText('Working', WORKING_ROW))
      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'idle', { seq: 2 })]))
      yield* eventually(() => {
        expect(screen.queryByText('Working', WORKING_ROW)).toBeNull()
      })
    }),
  )

  it.effect('keeps the same row element through every tool call of a turn', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'Fix the herd', 1)])])
      yield* Effect.promise(() => screen.findByText('Working', WORKING_ROW))

      const row = present(document.querySelector(ROW_ELEMENT), 'the Working row')

      yield* Queue.offer(
        transcript,
        chunk(10, 20, [toolUse(10, 'toolu_a', 'Bash', { command: 'bun test' }, 2)]),
      )
      yield* eventually(() => {
        expect(document.querySelector('[data-slot="tool-call"]')).not.toBeNull()
      })

      expect(document.querySelector(ROW_ELEMENT)).toBe(row)

      yield* Queue.offer(
        transcript,
        chunk(20, 30, [toolResult(20, 'toolu_a', 'ok', { seconds: 3 })]),
      )
      yield* Queue.offer(
        transcript,
        chunk(30, 40, [toolUse(30, 'toolu_b', 'Bash', { command: 'bun lint' }, 4)]),
      )
      yield* eventually(() => {
        expect(document.querySelectorAll('[data-slot="tool-call"]')).toHaveLength(2)
      })

      expect(document.querySelector(ROW_ELEMENT)).toBe(row)
      expect(screen.getByRole('button', { name: STOP })).toBeDefined()
    }),
  )

  it.effect('holds no row once a typed /compact has ended, with its command still unanswered', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, '/compact')])])
      yield* Effect.promise(() => screen.findByText('Working', WORKING_ROW))
      yield* Queue.offer(transcript, chunk(10, 20, [compactBoundary(10, 5)]))
      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'idle', { seq: 2 })]))
      yield* eventually(() => {
        expect(activityState()).toBe('Still')
      })

      expect(screen.queryByText('Working', WORKING_ROW)).toBeNull()
    }),
  )

  it.effect('goes with herdr alone when the watch failed, the row and Stop together', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const source = new PaneTranscript({ pane: PANE })
      const transcript = yield* link.transcriptFor(source)

      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'Fix the herd')])])
      yield* Effect.promise(() => screen.findByText('Working', WORKING_ROW))
      yield* link.endTranscript(source, new TranscriptReadFailed({ detail: 'disk unplugged' }))
      yield* findByRole('button', 'Try again')

      expect(screen.getByText('Working', WORKING_ROW)).toBeDefined()
      expect(screen.getByRole('button', { name: STOP })).toBeDefined()

      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'idle', { seq: 2 })]))
      yield* findByRole('button', SEND)

      expect(screen.queryByText('Working', WORKING_ROW)).toBeNull()
    }),
  )
})

describe('the queued label', () => {
  const delivered = (text: string) => Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text })))

  it.effect('reads Queued while the row holds past herdr going idle', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'Fix the herd')])])
      yield* Effect.promise(() => screen.findByText('Fix the herd'))
      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'idle', { seq: 2 })]))
      yield* eventually(() => {
        expect(activityState()).toBe('Holding')
      })
      yield* Ref.set(link.commandAnswer, delivered('And the tests'))
      yield* Effect.promise(() => userEvent.type(field(), 'And the tests{Enter}'))
      yield* eventually(() => {
        expect(screen.getAllByText('Queued')).toHaveLength(1)
      })

      expect(screen.queryByText('Sent')).toBeNull()
    }),
  )

  it.effect('reads Sent once the answer has landed, though herdr still says working', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(0, 20, [prompt(0, 'Fix the herd'), answered(10, 'Fixed the herd', 5)]),
      ])
      yield* eventually(() => {
        expect(activityState()).toBe('Finished')
      })
      yield* Ref.set(link.commandAnswer, delivered('And the tests'))
      yield* Effect.promise(() => userEvent.type(field(), 'And the tests{Enter}'))
      yield* eventually(() => {
        expect(screen.getAllByText('Sent')).toHaveLength(1)
      })

      expect(screen.queryByText('Queued')).toBeNull()
    }),
  )
})

describe('a subagent Working row', () => {
  const launched = [
    opened(),
    chunk(0, 30, [
      prompt(0, 'Review the diff'),
      toolUse(10, 'toolu_review', 'Agent', { description: 'Review', prompt: 'Read the diff.' }),
      toolResult(20, 'toolu_review', 'Async agent launched', {
        launch: new SubagentLaunch({ subagent: REVIEWER, status: 'async_launched' }),
      }),
    ]),
    caughtUp(30),
    new SubagentsChanged({
      session: SESSION,
      subagents: [subagent({ toolUseId: 'toolu_review' })],
    }),
  ]

  it.effect('holds its place across a tool call and goes when the run has finished', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(SUBAGENT, live([agent('w1:p1', 'working')]))
      const parent = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))
      const own = yield* link.transcriptFor(
        new SubagentTranscript({ session: SESSION, subagent: REVIEWER }),
      )

      yield* Queue.offerAll(parent, launched)
      yield* Queue.offerAll(own, [opened(), chunk(0, 10, [prompt(0, 'Read the diff.', 1)])])
      yield* Effect.promise(() => screen.findByText('Read the diff.'))
      yield* eventually(() => {
        expect(document.querySelectorAll(ROW_ELEMENT)).toHaveLength(2)
      })

      const row = present(lastRow(), 'the Working row')

      yield* Queue.offer(
        own,
        chunk(10, 20, [toolUse(10, 'toolu_a', 'Bash', { command: 'git' }, 2)]),
      )
      yield* eventually(() => {
        expect(document.querySelector('[data-slot="tool-call"]')).not.toBeNull()
      })

      expect(lastRow()).toBe(row)

      yield* Queue.offer(
        parent,
        new SubagentsChanged({
          session: SESSION,
          subagents: [subagent({ toolUseId: 'toolu_review', status: 'completed' })],
        }),
      )
      yield* eventually(() => {
        expect(document.querySelectorAll(ROW_ELEMENT)).toHaveLength(1)
      })
    }),
  )
})
