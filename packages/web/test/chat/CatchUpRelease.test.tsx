import { describe, expect, it } from '@effect/vitest'
import { screen, waitFor } from '@testing-library/react'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import { afterEach, beforeEach, vi } from 'vitest'

import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'
import { clockTime } from '@crook/web/time/Clock'

import { liveWith, renderApp } from '../AppRender.tsx'
import { eventually, present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { caughtUp, chunk, opened, said, SESSION } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812
const SETTLED_MS = 4000
const LONG_CATCH_UP = 25
const STEPPED_ROWS = 22
const LONG_RELEASE_MS = 8000
const MISSED = ['First on laptop.', 'Second on laptop.', 'Third on laptop.']

const source = new PaneTranscript({ pane: PANE })

const current = () =>
  liveWith(
    herd([
      machine(LAPTOP, [agent('w1:p1', 'idle', { claudeSession: SESSION })], {
        agentVersion: '0.0.1',
      }),
    ]),
  )

const divider = () => document.querySelector<HTMLElement>('[data-slot="catch-up-divider"]')

const chip = () => document.querySelector('[data-slot="catch-up-chip"]')

const trail = () =>
  document.querySelector('[data-slot="catch-up-trail"] path')?.getAttribute('d') ?? ''

const settles = (assertion: () => void) =>
  Effect.promise(() => waitFor(assertion, { timeout: SETTLED_MS }))

const hooked = settles(() => {
  expect(present(divider(), 'the catch-up divider').querySelector('.invisible')).toBeNull()
  expect(chip()).toBeNull()
})

const shownOf = (texts: readonly string[]) =>
  texts.filter((text) => screen.queryByText(text) !== null).length

const missedShown = () => shownOf(MISSED)

const watchReleases = (texts: readonly string[] = MISSED) => {
  const counts: number[] = []
  const observer = new MutationObserver(() => {
    const shown = shownOf(texts)

    if (counts.at(-1) !== shown) {
      counts.push(shown)
    }
  })

  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  return () => {
    observer.disconnect()

    return counts
  }
}

const follows = (earlier: Element, later: Element): boolean =>
  (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

const reopened = Effect.fn('reopened')(function* () {
  const { link, router } = yield* renderApp(CHAT, current())

  yield* Queue.offerAll(yield* link.transcriptFor(source), [
    opened(),
    chunk(0, 10, [said(0, 'Seen before.')]),
    caughtUp(10),
  ])
  yield* Effect.promise(() => screen.findByText('Seen before.'))

  expect(divider()).toBeNull()
  expect(chip()).toBeNull()

  yield* Effect.promise(() => router.navigate({ to: '/' }))
  yield* eventually(() => {
    expect(screen.queryByText('Seen before.')).toBeNull()
  })
  yield* Effect.promise(() =>
    router.navigate({ to: '/m/$machine/p/$pane', params: { machine: LAPTOP, pane: PANE } }),
  )
  yield* Effect.promise(() => screen.findByText('Seen before.'))

  return link
})

const missedWhileAway = Effect.fn('missedWhileAway')(function* () {
  const link = yield* reopened()
  const releases = watchReleases()

  yield* Queue.offerAll(yield* link.transcriptFor(source), [
    chunk(
      10,
      40,
      MISSED.map((text, index) => said(10 + index * 10, text)),
    ),
    caughtUp(40),
  ])

  return { link, releases }
})

beforeEach(() => {
  stubMediaQueries([])
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(DateTime.addDuration(START, Duration.minutes(5)).epochMilliseconds)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('a laptop catch-up', () => {
  it.effect('releases what the laptop wrote one row at a time', () =>
    Effect.gen(function* () {
      const { releases } = yield* missedWhileAway()

      yield* settles(() => {
        expect(missedShown()).toBe(MISSED.length)
      })

      expect(releases().filter((shown) => shown > 0)).toStrictEqual([1, 2, 3])
    }),
  )

  it.effect('hooks the released rows into an On laptop divider with their time', () =>
    Effect.gen(function* () {
      yield* missedWhileAway()
      yield* hooked

      const found = present(divider(), 'the catch-up divider')

      expect(found.textContent).toContain('On laptop')
      expect(found.textContent).toContain(clockTime(DateTime.makeUnsafe('2026-10-20T12:00:00Z')))
      expect(found.querySelector('.invisible')).toBeNull()
      expect(follows(screen.getByText('Third on laptop.'), found)).toBe(true)
      expect(trail()).toMatch(/^M7 \d+ V\d+ A8 8 0 0 0 15 \d+ H\d+$/u)
    }),
  )

  it.effect('carries a laptop chip down the rows while they release', () =>
    Effect.gen(function* () {
      yield* missedWhileAway()
      yield* eventually(() => {
        expect(chip()).not.toBeNull()
      })

      expect(chip()?.textContent).toContain('laptop')
      expect(present(divider(), 'the catch-up divider').querySelector('.invisible')).not.toBeNull()
    }),
  )

  it.effect(
    'lets lines that arrive after the catch-up follow the divider without one of their own',
    () =>
      Effect.gen(function* () {
        const { link } = yield* missedWhileAway()

        yield* settles(() => {
          expect(chip()).toBeNull()
        })
        yield* Queue.offerAll(yield* link.transcriptFor(source), [
          chunk(40, 50, [said(40, 'Sent from the phone.')]),
        ])

        const sent = yield* Effect.promise(() => screen.findByText('Sent from the phone.'))

        expect(follows(present(divider(), 'the catch-up divider'), sent)).toBe(true)
        expect(document.querySelectorAll('[data-slot="catch-up-divider"]')).toHaveLength(1)
      }),
  )

  it.effect(
    'lands the earlier rows of a long catch-up at once and releases the last 22',
    () =>
      Effect.gen(function* () {
        const link = yield* reopened()
        const missed = Arr.makeBy(LONG_CATCH_UP, (index) => `Long line ${index}.`)
        const releases = watchReleases(missed)

        yield* Queue.offerAll(yield* link.transcriptFor(source), [
          chunk(
            10,
            10 + LONG_CATCH_UP * 10,
            missed.map((text, index) => said(10 + index * 10, text)),
          ),
          caughtUp(10 + LONG_CATCH_UP * 10),
        ])
        yield* Effect.promise(() =>
          waitFor(
            () => {
              expect(shownOf(missed)).toBe(LONG_CATCH_UP)
            },
            { timeout: LONG_RELEASE_MS },
          ),
        )

        const seen = releases().filter((shown) => shown > 0)

        expect(seen[0]).toBe(LONG_CATCH_UP - STEPPED_ROWS)
        expect(seen).toHaveLength(STEPPED_ROWS + 1)
      }),
    LONG_RELEASE_MS * 2,
  )

  it.effect('shows no divider when nothing happened on the laptop', () =>
    Effect.gen(function* () {
      const link = yield* reopened()

      yield* Queue.offerAll(yield* link.transcriptFor(source), [caughtUp(10)])
      yield* eventually(() => {
        expect(document.querySelector('[data-slot="catching-up-pill"]')).toBeNull()
      })
      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        chunk(10, 20, [said(10, 'Live after opening.')]),
      ])
      yield* Effect.promise(() => screen.findByText('Live after opening.'))

      expect(divider()).toBeNull()
      expect(chip()).toBeNull()
    }),
  )
})
