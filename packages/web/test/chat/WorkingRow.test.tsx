import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import type { AgentRow } from '@crook/domain/AgentRow'
import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'

import { liveWith, renderApp } from '../AppRender.tsx'
import { eventually, findByRole } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { answered, chunk, opened, prompt } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812

const live = (rows: readonly AgentRow[]) => liveWith(herd([machine(LAPTOP, rows)]))

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

describe('the Working row', () => {
  it.effect('keeps the Working row until the answer lands when herdr goes idle first', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(
        CHAT,
        live([agent('w1:p1', 'working', { secondsAgo: 120 })]),
      )
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'Fix the herd')])])
      yield* Effect.promise(() => screen.findByText('Fix the herd'))
      yield* Effect.promise(() => screen.findByText('Working'))
      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'idle', { seq: 2 })]))
      yield* findByRole('button', 'Send')

      expect(screen.getByText('Working')).toBeDefined()
      expect(screen.getByText('7m')).toBeDefined()

      yield* Queue.offer(transcript, chunk(10, 20, [answered(10, 'Fixed the herd', 5)]))
      yield* Effect.promise(() => screen.findByText('Fixed the herd'))

      expect(screen.queryByText('Working')).toBeNull()
    }),
  )

  it.effect('drops the Working row with the answer while herdr still says Claude works', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working')]))
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'Fix the herd')])])
      yield* Effect.promise(() => screen.findByText('Fix the herd'))
      yield* Effect.promise(() => screen.findByText('Working'))
      yield* Queue.offer(transcript, chunk(10, 20, [answered(10, 'Fixed the herd', 5)]))
      yield* Effect.promise(() => screen.findByText('Fixed the herd'))

      expect(screen.queryByText('Working')).toBeNull()
      expect(screen.getByRole('button', { name: 'Stop (Esc)' })).toBeDefined()
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
      yield* Effect.promise(() => screen.findByText('Working'))
      yield* SubscriptionRef.set(link.state, live([agent('w1:p1', 'idle', { seq: 2 })]))
      yield* eventually(() => {
        expect(screen.queryByText('Working')).toBeNull()
      })
    }),
  )
})
