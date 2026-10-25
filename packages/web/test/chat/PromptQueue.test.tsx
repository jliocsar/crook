import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import { afterEach, beforeEach, vi } from 'vitest'

import type { AgentRow } from '@crook/domain/AgentRow'
import { Prompt } from '@crook/domain/Command'
import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'
import { TextBlock } from '@crook/domain/TranscriptMessage'

import { liveWith, renderApp } from '../AppRender.tsx'
import { eventually, present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { inputDelivered } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { chunk, opened, prompt, user } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812

const live = (rows: readonly AgentRow[]) => liveWith(herd([machine(LAPTOP, rows)]))

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

describe('prompts sent while Claude has others to read', () => {
  it.effect('queues a second prompt behind the first until the transcript holds both', () =>
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
        expect(screen.getByText('Queued')).toBeDefined()
      })

      expect(screen.getByText('second')).toBeDefined()
      expect(screen.getByText('third')).toBeDefined()
      expect(screen.getByText('Sent')).toBeDefined()

      yield* Queue.offer(transcript, chunk(10, 20, [prompt(10, 'second')]))
      yield* eventually(() => {
        expect(screen.queryByText('Sent')).toBeNull()
      })

      expect(screen.getAllByText('second')).toHaveLength(1)
      expect(screen.getByText('Queued')).toBeDefined()

      yield* Queue.offer(transcript, chunk(20, 30, [prompt(20, 'third')]))
      yield* eventually(() => {
        expect(screen.queryByText('Queued')).toBeNull()
      })

      expect(screen.getAllByText('third')).toHaveLength(1)
    }),
  )

  it.effect('queues each prompt sent while Claude works until Claude takes it', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'Write the docs')])])
      yield* Effect.promise(() => screen.findByText('Write the docs'))
      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: 'Also the tests' }))),
      )
      yield* Effect.promise(() => userEvent.type(field(), 'Also the tests{Enter}'))
      yield* eventually(() => {
        expect(screen.getAllByText('Queued')).toHaveLength(1)
      })
      yield* Ref.set(
        link.commandAnswer,
        Exit.succeed(inputDelivered(new Prompt({ pane: PANE, text: 'And the changelog' }))),
      )
      yield* Effect.promise(() => userEvent.type(field(), 'And the changelog{Enter}'))
      yield* eventually(() => {
        expect(screen.getAllByText('Queued')).toHaveLength(2)
      })

      expect(screen.queryByText('Sent')).toBeNull()

      yield* Queue.offer(
        transcript,
        chunk(10, 20, [user(10, [new TextBlock({ text: 'Also the tests' })], { queued: true })]),
      )
      yield* eventually(() => {
        expect(screen.getAllByText('Also the tests')).toHaveLength(1)
      })

      expect(screen.getAllByText('Queued')).toHaveLength(2)

      yield* Queue.offer(transcript, chunk(20, 30, [prompt(20, 'And the changelog')]))
      yield* eventually(() => {
        expect(screen.getAllByText('Queued')).toHaveLength(1)
      })

      expect(screen.getAllByText('And the changelog')).toHaveLength(1)
      expect(screen.queryByText('Sent')).toBeNull()
    }),
  )
})
