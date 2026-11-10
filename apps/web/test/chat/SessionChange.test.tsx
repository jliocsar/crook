import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import { afterEach, beforeEach, vi } from 'vitest'

import { PaneId, TranscriptOffset } from '@crook/domain/Ids'
import { omittedUpTo, PaneTranscript } from '@crook/domain/Transcript'
import { LocalCommandBlock } from '@crook/domain/TranscriptMessage'

import { liveWith, renderApp } from '../AppRender.tsx'
import { present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { caughtUp, chunk, NEXT_SESSION, opened, said, user } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812

const chatOpen = Effect.gen(function* () {
  const { link } = yield* renderApp(
    CHAT,
    liveWith(herd([machine(LAPTOP, [agent('w1:p1', 'idle')])])),
  )
  const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

  yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [said(0, 'The old thread.')])])
  yield* Effect.promise(() => screen.findByText('The old thread.'))

  return transcript
})

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

describe('a chat whose pane changes session', () => {
  it.effect('replaces the thread on /clear, with one cleared row, and keeps the draft', () =>
    Effect.gen(function* () {
      const transcript = yield* chatOpen
      const before = document.querySelector('[data-slot="conversation-viewport"]')
      const field = present(screen.queryByRole('textbox'), 'The composer')

      yield* Effect.promise(() => userEvent.type(field, 'half a thought'))
      yield* Queue.offerAll(transcript, [
        opened(NEXT_SESSION),
        chunk(
          0,
          10,
          [user(0, [new LocalCommandBlock({ name: '/clear', args: '' })])],
          NEXT_SESSION,
        ),
        caughtUp(10, NEXT_SESSION),
      ])
      yield* Effect.promise(() => screen.findByText('Conversation cleared'))

      expect(screen.queryByText('The old thread.')).toBeNull()
      expect(screen.getAllByText('Conversation cleared')).toHaveLength(1)
      expect(screen.queryByText('/clear')).toBeNull()
      expect(present(screen.queryByRole('textbox'), 'The composer')).toHaveProperty(
        'value',
        'half a thought',
      )
      expect(document.querySelector('[data-slot="conversation-viewport"]')).not.toBe(before)
    }),
  )

  it.effect('shows the tail of a resumed session with Show earlier and no cleared row', () =>
    Effect.gen(function* () {
      const transcript = yield* chatOpen

      yield* Queue.offerAll(transcript, [
        opened(NEXT_SESSION),
        omittedUpTo(NEXT_SESSION, TranscriptOffset.make(4096)),
        chunk(4096, 4106, [said(4096, 'Where we left off.')], NEXT_SESSION),
        caughtUp(4106, NEXT_SESSION),
      ])
      yield* Effect.promise(() => screen.findByText('Where we left off.'))

      expect(screen.queryByText('The old thread.')).toBeNull()
      expect(screen.queryByText('Conversation cleared')).toBeNull()
      expect(screen.getByRole('button', { name: /Show earlier messages/u })).toBeDefined()
    }),
  )
})
