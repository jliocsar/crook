import { describe, expect, it } from '@effect/vitest'
import { act } from '@testing-library/react'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import { afterEach, beforeEach, vi } from 'vitest'

import { ShellTask } from '@crook/domain/Background'
import { PaneId } from '@crook/domain/Ids'
import { BackgroundChanged, PaneTranscript } from '@crook/domain/Transcript'

import { liveWith, renderApp } from '../AppRender.tsx'
import { eventually, present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { chunk, opened, prompt, SESSION, toolResult, toolUse } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812
const CARD_HEIGHT = 170
const MARKER_HEIGHT = 44
const NOW = DateTime.addDuration(START, Duration.minutes(5))

const devServer = new ShellTask({
  taskId: 'bdev',
  toolUseId: 'toolu_dev',
  status: 'running',
  summary: Option.none(),
  stoppedByClaude: false,
  startedAt: Option.some(DateTime.subtract(NOW, { seconds: 70 })),
  endedAt: Option.none(),
  command: Option.some('bun run dev'),
  description: Option.some('Start the dev server'),
  checkedAt: [],
  output: ['ready in 876 ms'],
  lastOutputAt: Option.some(DateTime.subtract(NOW, { seconds: 2 })),
  alive: Option.some(true),
})

const launched = chunk(0, 30, [
  prompt(0, 'Bring up the dev server'),
  toolUse(10, 'toolu_dev', 'Bash', { command: 'bun run dev', run_in_background: true }),
  toolResult(20, 'toolu_dev', 'Command running in background with ID: bdev.'),
])

const heightOf = (row: Element): number =>
  row.querySelector('[data-slot="background-marker"]') === null ? CARD_HEIGHT : MARKER_HEIGHT

const measuredRows = () => {
  const observed = new Set<Element>()
  const reports = new Set<ResizeObserverCallback>()

  class ContentResizeObserver {
    constructor(report: ResizeObserverCallback) {
      reports.add(report)
    }

    observe(target: Element) {
      observed.add(target)
    }

    unobserve(target: Element) {
      observed.delete(target)
    }

    disconnect() {}
  }

  vi.stubGlobal('ResizeObserver', ContentResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(
    function rendered(this: HTMLElement) {
      return this.hasAttribute('data-index') ? heightOf(this) : 0
    },
  )

  return () => {
    act(() => {
      const entries = pipe(
        [...observed],
        Arr.filter((target) => target.hasAttribute('data-index')),
        Arr.map((target) => ({
          target,
          borderBoxSize: [{ blockSize: heightOf(target), inlineSize: VIEWPORT_WIDTH }],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
          contentRect: new DOMRect(0, 0, VIEWPORT_WIDTH, heightOf(target)),
        })),
      )

      for (const report of reports) {
        report(entries, new ContentResizeObserver(report))
      }
    })
  }
}

const contentHeight = (): number =>
  Number.parseFloat(
    present(
      document.querySelector<HTMLElement>('[data-slot="conversation-content"]'),
      'the thread content',
    ).style.height,
  )

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW.epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a background marker in the thread', () => {
  it.effect('takes the height of the marker, not of the tool card it replaced', () =>
    Effect.gen(function* () {
      const measure = measuredRows()
      const { link } = yield* renderApp(
        CHAT,
        liveWith(herd([machine(LAPTOP, [agent('w1:p1', 'working')])])),
      )
      const transcript = yield* link.transcriptFor(new PaneTranscript({ pane: PANE }))

      yield* Queue.offerAll(transcript, [opened(), launched])
      yield* eventually(() => {
        expect(
          Arr.some([...document.querySelectorAll('[data-row]')], (row) =>
            (row.textContent ?? '').includes('bun run dev'),
          ),
        ).toBe(true)
      })
      measure()

      const withCard = contentHeight()

      yield* Queue.offer(
        transcript,
        new BackgroundChanged({ session: SESSION, tasks: [devServer], activity: [] }),
      )
      yield* eventually(() => {
        expect(document.querySelector('[data-slot="background-marker"]')).not.toBeNull()
      })
      measure()

      expect(withCard - contentHeight()).toBe(CARD_HEIGHT - MARKER_HEIGHT)
    }),
  )
})
