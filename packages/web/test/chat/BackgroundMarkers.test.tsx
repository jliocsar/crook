import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import { afterEach, beforeEach, vi } from 'vitest'

import { ShellTask } from '@crook/domain/Background'
import { PaneId } from '@crook/domain/Ids'
import type { SubagentStatus } from '@crook/domain/Subagent'
import { BackgroundChanged, PaneTranscript } from '@crook/domain/Transcript'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { chunk, opened, prompt, SESSION, toolResult, toolUse } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812
const NOW = DateTime.addDuration(START, Duration.minutes(5))

const devServer = (status: SubagentStatus) =>
  new ShellTask({
    taskId: 'bdev',
    toolUseId: 'toolu_dev',
    status,
    summary: Option.none(),
    stoppedByClaude: status === 'stopped',
    startedAt: Option.some(DateTime.subtract(NOW, { seconds: 70 })),
    endedAt:
      status === 'running' ? Option.none() : Option.some(DateTime.subtract(NOW, { seconds: 5 })),
    command: Option.some('bun run dev'),
    description: Option.some('Start the dev server'),
    checkedAt: [],
    output: ['ready in 876 ms'],
    lastOutputAt: Option.some(DateTime.subtract(NOW, { seconds: 2 })),
    alive: Option.some(status === 'running'),
  })

const launched = chunk(0, 30, [
  prompt(0, 'Bring up the dev server'),
  toolUse(10, 'toolu_dev', 'Bash', { command: 'bun run dev', run_in_background: true }),
  toolResult(20, 'toolu_dev', 'Command running in background with ID: bdev.'),
])

const movedByTimeout = chunk(0, 30, [
  prompt(0, 'Bring up the dev server'),
  toolUse(10, 'toolu_dev', 'Bash', { command: 'bun run dev' }),
  toolResult(
    20,
    'toolu_dev',
    'Command did not complete within its 120s timeout and was moved to the background (ID: bdev).',
  ),
])

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW.epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('background work in the chat', () => {
  it.effect('marks where a background shell started and opens it from there', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(
        CHAT,
        liveWith(herd([machine(LAPTOP, [agent('w1:p1', 'working')])])),
      )
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        launched,
        new BackgroundChanged({ session: SESSION, tasks: [devServer('running')], activity: [] }),
      ])

      const marker = yield* Effect.promise(() =>
        screen.findByText(
          (_text, element) =>
            element?.getAttribute('data-slot') === 'background-marker' &&
            (element.textContent ?? '').includes('live below'),
        ),
      )

      expect(screen.getByText('1 running')).toBeDefined()

      yield* click(marker)

      const sheet = yield* findByRole('dialog', 'bun run dev')

      expect(sheet.textContent).toContain('ready in 876 ms')
    }),
  )

  it.effect('settles the marker once the shell has stopped', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(
        CHAT,
        liveWith(herd([machine(LAPTOP, [agent('w1:p1', 'working')])])),
      )
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        launched,
        new BackgroundChanged({ session: SESSION, tasks: [devServer('stopped')], activity: [] }),
      ])

      yield* eventually(() => {
        const marker = document.querySelector('[data-slot="background-marker"]')

        expect(marker?.getAttribute('data-state')).toBe('stopped')
        expect(marker?.textContent).toContain('bun run dev · ran 1m 05s · stopped')
      })
    }),
  )

  it.effect('marks a shell its timeout moved to the background', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(
        CHAT,
        liveWith(herd([machine(LAPTOP, [agent('w1:p1', 'working')])])),
      )
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [
        opened(),
        movedByTimeout,
        new BackgroundChanged({ session: SESSION, tasks: [devServer('running')], activity: [] }),
      ])

      yield* eventually(() => {
        const marker = document.querySelector('[data-slot="background-marker"]')

        expect(marker?.getAttribute('data-state')).toBe('running')
      })
    }),
  )
})
