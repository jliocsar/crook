import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import { afterEach, beforeEach, vi } from 'vitest'

import type { AgentRow } from '@crook/domain/AgentRow'
import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'
import type { PromptSender } from '@crook/domain/TranscriptMessage'

import { liveWith, renderApp } from '../AppRender.tsx'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { phoneViewport } from '../ThreadRender.tsx'
import { chunk, opened, prompt, sentCommand, sentPrompt } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const WORDS = 'A made-up reply'
const WORKING_ROW = { selector: '[data-slot="thinking-state-label"]' }
const BUBBLE = '[data-slot="message"]'

const live = (rows: readonly AgentRow[]) => liveWith(herd([machine(LAPTOP, rows)]))

const opensOn = (lines: Parameters<typeof chunk>[2]) =>
  Effect.gen(function* () {
    const { link } = yield* renderApp(CHAT, live([agent('w1:p1', 'working', { secondsAgo: 120 })]))
    const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

    yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, lines)])
  })

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

describe('a prompt no one typed', () => {
  const labelled: readonly (readonly [string, PromptSender, string])[] = [
    ['a named plugin', { kind: 'plugin', name: 'madeup' }, 'From madeup'],
    ['a plugin with no name', { kind: 'plugin' }, 'From a plugin'],
    ['a scheduled task', { kind: 'scheduled' }, 'Scheduled'],
    ['a script', { kind: 'sdk' }, 'From a script'],
    ['a sender this build never heard of', { kind: 'made_up_origin' }, 'Not typed by you'],
  ]

  it.effect.each(labelled)('reads as %s, folded and never as your bubble', ([, sender, label]) =>
    Effect.gen(function* () {
      yield* opensOn([sentPrompt(0, WORDS, sender, 1)])

      const row = yield* Effect.promise(() => screen.findByRole('button', { name: label }))

      expect(document.querySelector(BUBBLE)).toBeNull()
      expect(screen.queryByText(WORDS)).toBeNull()

      yield* Effect.promise(() => userEvent.click(row))
      yield* Effect.promise(() => screen.findByText(WORDS))
    }),
  )

  it.effect('opens a turn as any prompt does, so the Working row shows', () =>
    Effect.gen(function* () {
      yield* opensOn([sentPrompt(0, WORDS, { kind: 'plugin', name: 'madeup' }, 1)])
      yield* Effect.promise(() => screen.findByText('Working', WORKING_ROW))
    }),
  )

  it.effect('names who sent a command, with no bubble saying it was you', () =>
    Effect.gen(function* () {
      yield* opensOn([sentCommand(0, '/sweep', 'tick', { kind: 'scheduled' }, 1)])
      yield* Effect.promise(() => screen.findByText('Scheduled: /sweep tick'))

      expect(document.querySelector(BUBBLE)).toBeNull()
    }),
  )

  it.effect('stays your bubble on a line from an agent too old to say who sent it', () =>
    Effect.gen(function* () {
      yield* opensOn([prompt(0, WORDS, 1)])
      yield* Effect.promise(() => screen.findByText(WORDS))

      expect(document.querySelector(BUBBLE)).not.toBeNull()
    }),
  )
})
