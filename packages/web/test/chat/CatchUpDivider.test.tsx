import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
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
import { keepOnThisDevice } from '../HubFakes.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { caughtUp, chunk, opened, said, SESSION } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812
const LONG_CATCH_UP = 25
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

const shownOf = (texts: readonly string[]) =>
  texts.filter((text) => screen.queryByText(text) !== null).length

const watchLandings = (texts: readonly string[]) => {
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

const landsBeforeItsFirstCommit = Effect.fn('landsBeforeItsFirstCommit')(function* () {
  const landings = watchLandings(['Seen before.', ...MISSED])
  const statesSeen = new Set<string>()
  const states = new MutationObserver(() => {
    const thread = document.querySelector('[data-machine="transcript"]')

    statesSeen.add(thread?.getAttribute('data-state') ?? 'none')
  })

  states.observe(document.body, { subtree: true, childList: true, attributes: true })

  yield* renderApp(CHAT, current(), (link) =>
    Effect.gen(function* () {
      yield* keepOnThisDevice(link, { machine: LAPTOP, pane: PANE, session: SESSION }, [
        opened(),
        chunk(0, 10, [said(0, 'Seen before.')]),
        caughtUp(10),
      ])
      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        chunk(
          10,
          40,
          MISSED.map((text, index) => said(10 + index * 10, text)),
        ),
        caughtUp(40),
      ])
    }),
  )
  yield* Effect.promise(() => screen.findByText('Third on laptop.'))
  states.disconnect()

  return { landings: landings(), statesSeen }
})

const missedWhileAway = Effect.fn('missedWhileAway')(function* () {
  const link = yield* reopened()
  const landings = watchLandings(MISSED)

  yield* Queue.offerAll(yield* link.transcriptFor(source), [
    chunk(
      10,
      40,
      MISSED.map((text, index) => said(10 + index * 10, text)),
    ),
    caughtUp(40),
  ])
  yield* Effect.promise(() => screen.findByText('Third on laptop.'))

  return { link, landings }
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
  it.effect('lands what the laptop wrote in one commit', () =>
    Effect.gen(function* () {
      const { landings } = yield* missedWhileAway()

      expect(landings().filter((shown) => shown > 0)).toStrictEqual([MISSED.length])
    }),
  )

  it.effect('lands a long catch-up in one commit too', () =>
    Effect.gen(function* () {
      const link = yield* reopened()
      const missed = Arr.makeBy(LONG_CATCH_UP, (index) => `Long line ${index}.`)
      const landings = watchLandings(missed)

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        chunk(
          10,
          10 + LONG_CATCH_UP * 10,
          missed.map((text, index) => said(10 + index * 10, text)),
        ),
        caughtUp(10 + LONG_CATCH_UP * 10),
      ])
      yield* Effect.promise(() => screen.findByText(`Long line ${LONG_CATCH_UP - 1}.`))

      expect(landings().filter((shown) => shown > 0)).toHaveLength(1)
    }),
  )

  it.effect('puts a static On laptop divider with their time above the first new row', () =>
    Effect.gen(function* () {
      yield* missedWhileAway()

      const found = present(divider(), 'the catch-up divider')

      expect(found.textContent).toContain('On laptop')
      expect(found.textContent).toContain(clockTime(DateTime.makeUnsafe('2026-10-20T12:00:00Z')))
      expect(follows(screen.getByText('Seen before.'), found)).toBe(true)
      expect(follows(found, screen.getByText('First on laptop.'))).toBe(true)
    }),
  )

  it.effect(
    'lets lines that arrive after the catch-up follow the divider without one of their own',
    () =>
      Effect.gen(function* () {
        const { link } = yield* missedWhileAway()

        yield* Queue.offerAll(yield* link.transcriptFor(source), [
          chunk(40, 50, [said(40, 'Sent from the phone.')]),
        ])

        const sent = yield* Effect.promise(() => screen.findByText('Sent from the phone.'))

        expect(follows(present(divider(), 'the catch-up divider'), sent)).toBe(true)
        expect(document.querySelectorAll('[data-slot="catch-up-divider"]')).toHaveLength(1)
      }),
  )

  it.effect('marks what lands before the cached rows ever committed', () =>
    Effect.gen(function* () {
      const { landings, statesSeen } = yield* landsBeforeItsFirstCommit()
      const found = present(divider(), 'the catch-up divider')

      expect(statesSeen.has('Cached')).toBe(false)
      expect(statesSeen.has('Holding')).toBe(false)
      expect(landings.filter((shown) => shown > 0)).toStrictEqual([MISSED.length + 1])
      expect(follows(screen.getByText('Seen before.'), found)).toBe(true)
      expect(follows(found, screen.getByText('First on laptop.'))).toBe(true)
    }),
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
    }),
  )
})
