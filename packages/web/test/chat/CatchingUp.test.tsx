import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import { PaneId, TranscriptOffset } from '@crook/domain/Ids'
import { omittedUpTo, PaneTranscript } from '@crook/domain/Transcript'
import { TranscriptReadFailed } from '@crook/protocol/Transcripts'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole, present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { caughtUp, chunk, opened, said, SESSION } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812

const source = new PaneTranscript({ pane: PANE })

const laptop = (connection: 'online' | 'offline') =>
  liveWith(
    herd([
      machine(LAPTOP, [agent('w1:p1', 'idle', { claudeSession: SESSION })], {
        agentVersion: '0.0.1',
        connection,
      }),
    ]),
  )

const current = () => laptop('online')

const catchingUpPill = () => document.querySelector('[data-slot="catching-up-pill"]')

const dimmedFlags = () =>
  Array.from(document.querySelectorAll('[data-dimmed]'), (element) =>
    element.getAttribute('data-dimmed'),
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

describe('a chat catching up', () => {
  it.effect('says so in the header while a reopened chat catches up, and does not dim it', () =>
    Effect.gen(function* () {
      const { link, router } = yield* renderApp(CHAT, current())

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(0, 10, [said(0, 'Seen before.')]),
        caughtUp(10),
      ])
      yield* Effect.promise(() => screen.findByText('Seen before.'))

      expect(catchingUpPill()).toBeNull()

      yield* Effect.promise(() => router.navigate({ to: '/' }))
      yield* eventually(() => {
        expect(screen.queryByText('Seen before.')).toBeNull()
      })
      yield* Effect.promise(() =>
        router.navigate({ to: '/m/$machine/p/$pane', params: { machine: LAPTOP, pane: PANE } }),
      )
      yield* Effect.promise(() => screen.findByText('Seen before.'))

      expect(catchingUpPill()).not.toBeNull()
      expect(screen.getAllByRole('status').map((status) => status.textContent)).toContain(
        'Catching up',
      )
      expect(dimmedFlags()).not.toContain('true')

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(10, 20, [said(10, 'Missed while away.')]),
        caughtUp(20),
      ])
      yield* Effect.promise(() => screen.findByText('Missed while away.'))
      yield* eventually(() => {
        expect(catchingUpPill()).toBeNull()
      })
    }),
  )

  it.effect(
    'lands a laptop catch-up at once, its divider already drawn, when motion is reduced',
    () =>
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
        yield* Effect.promise(() => screen.findByText('Seen before.'))
        yield* Queue.offerAll(yield* link.transcriptFor(source), [
          opened(),
          chunk(10, 30, [said(10, 'First missed.'), said(20, 'Second missed.')]),
          caughtUp(30),
        ])
        yield* Effect.promise(() => screen.findByText('Second missed.'))

        const divider = present(
          document.querySelector('[data-slot="catch-up-divider"]'),
          'the catch-up divider',
        )

        expect(screen.getByText('First missed.')).toBeDefined()
        expect(divider.textContent).toContain('On laptop')
        expect(divider.querySelector('.invisible')).toBeNull()
        expect(document.querySelector('[data-slot="catch-up-chip"]')).toBeNull()
        expect(
          document.querySelector('[data-slot="catch-up-trail"] path')?.getAttribute('d'),
        ).toMatch(/^M7 \d+ V\d+ A8 8 0 0 0 15 \d+ H\d+$/u)
      }),
  )

  it.effect('marks Show earlier as loading until the whole chat has caught up', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, current())

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        omittedUpTo(SESSION, TranscriptOffset.make(10)),
        chunk(10, 20, [said(10, 'Recent line.')]),
        caughtUp(20),
      ])
      yield* click(yield* findByRole('button', 'Show earlier messages'))

      expect(
        (yield* findByRole('button', 'Loading earlier messages')).hasAttribute('disabled'),
      ).toBe(true)
      expect(screen.getByText('Recent line.')).toBeDefined()

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes)).toHaveLength(2)
      })
      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(0, 20, [said(0, 'Early line.'), said(10, 'Recent line.')]),
        caughtUp(20),
      ])

      expect(yield* Effect.promise(() => screen.findByText('Early line.'))).toBeDefined()
      expect(screen.queryByRole('button', { name: 'Loading earlier messages' })).toBeNull()
    }),
  )

  it.effect('marks Try again as trying until the watch delivers again', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, current())

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes)).toHaveLength(1)
      })
      yield* link.endTranscript(source, new TranscriptReadFailed({ detail: 'disk unplugged' }))
      yield* click(yield* findByRole('button', 'Try again'))

      expect((yield* findByRole('button', 'Trying again')).hasAttribute('disabled')).toBe(true)

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(0, 10, [said(0, 'Readable again.')]),
        caughtUp(10),
      ])

      expect(yield* Effect.promise(() => screen.findByText('Readable again.'))).toBeDefined()
      expect(screen.queryByRole('button', { name: 'Trying again' })).toBeNull()
    }),
  )

  it.effect('dims the chat of a machine that went away instead of saying it catches up', () =>
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
      yield* SubscriptionRef.set(link.state, laptop('offline'))
      yield* Effect.promise(() =>
        router.navigate({ to: '/m/$machine/p/$pane', params: { machine: LAPTOP, pane: PANE } }),
      )
      yield* Effect.promise(() => screen.findByText('Seen before.'))
      yield* eventually(() => {
        expect(dimmedFlags()).toContain('true')
      })

      expect(catchingUpPill()).toBeNull()
    }),
  )
})
