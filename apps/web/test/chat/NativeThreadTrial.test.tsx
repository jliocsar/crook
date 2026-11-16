import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import { afterEach, beforeEach, vi } from 'vitest'

import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'
import { setNativeThread } from '@crook/web/chat/ThreadTrial'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole } from '../Dom.ts'
import { agent, herd, LAPTOP, machine } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { caughtUp, chunk, opened, prompt, said } from '../TranscriptFixtures.ts'

const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812
const LONG_CHAT_LINES = 70

const viewport = () => document.querySelector<HTMLElement>('[data-slot="conversation-viewport"]')

const openChat = Effect.fn('openChat')(function* () {
  const { link } = yield* renderApp(
    CHAT,
    liveWith(herd([machine(LAPTOP, [agent('w1:p1', 'idle')])])),
  )
  const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PaneId.make('w1:p1') }))

  yield* Queue.offerAll(transcript, [
    opened(),
    chunk(0, 20, [prompt(0, 'Fix the herd screen'), said(10, 'Fixed it.')]),
    caughtUp(20),
  ])
  yield* eventually(() => {
    expect(viewport()).not.toBeNull()
  })
})

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT)
})

afterEach(() => {
  setNativeThread(false)
  vi.restoreAllMocks()
})

describe('the chat scrolling trial', () => {
  it.effect('keeps the current thread while the trial is off', () =>
    Effect.gen(function* () {
      yield* openChat()

      expect(viewport()?.dataset['thread']).toBeUndefined()
    }),
  )

  it.effect('shows the rows in a reversed list in their order once the trial is on', () =>
    Effect.gen(function* () {
      setNativeThread(true)
      yield* openChat()
      yield* Effect.promise(() => screen.findByText('Fixed it.'))

      const texts = Array.from(document.querySelectorAll('[data-row]'), (row) => row.textContent)

      expect(viewport()?.dataset['thread']).toBe('native')
      expect(texts.findIndex((text) => text.includes('Fix the herd screen'))).toBeLessThan(
        texts.findIndex((text) => text.includes('Fixed it.')),
      )
    }),
  )

  it.effect('renders the newest rows of a long chat and the earlier ones on a tap', () =>
    Effect.gen(function* () {
      setNativeThread(true)
      const { link } = yield* renderApp(
        CHAT,
        liveWith(herd([machine(LAPTOP, [agent('w1:p1', 'idle')])])),
      )
      const transcript = yield* link.transcriptFor(
        new PaneTranscript({ pane: PaneId.make('w1:p1') }),
      )

      yield* Queue.offerAll(transcript, [
        opened(),
        chunk(
          0,
          LONG_CHAT_LINES,
          Array.from({ length: LONG_CHAT_LINES }, (_unused, line) => said(line, `Line ${line}`)),
        ),
        caughtUp(LONG_CHAT_LINES),
      ])
      yield* Effect.promise(() => screen.findByText(`Line ${LONG_CHAT_LINES - 1}`))

      expect(screen.queryByText('Line 0')).toBeNull()

      yield* click(yield* findByRole('button', 'Show earlier messages'))
      yield* Effect.promise(() => screen.findByText('Line 0'))

      expect(screen.queryByRole('button', { name: 'Show earlier messages' })).toBeNull()
    }),
  )
})
