import { describe, expect, it } from '@effect/vitest'
import { screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { afterEach, beforeEach, vi } from 'vitest'

import { PaneId, TranscriptOffset } from '@crook/domain/Ids'
import { omittedBetween, omittedUpTo, PaneTranscript } from '@crook/domain/Transcript'
import { TranscriptReadFailed, TranscriptResumeRejected } from '@crook/protocol/Transcripts'
import { SYNC_NOTICE_DELAY } from '@crook/web/rpc/HubLink'

import { liveWith, renderApp } from '../AppRender.tsx'
import { click, eventually, findByRole, present } from '../Dom.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { caughtUp, chunk, NEXT_SESSION, opened, said, SESSION } from '../TranscriptFixtures.ts'

const PANE = PaneId.make('w1:p1')
const CHAT = '/m/laptop/p/w1:p1'
const VIEWPORT_WIDTH = 375
const VIEWPORT_HEIGHT = 812

const source = new PaneTranscript({ pane: PANE })

const OLDER_AGENT = '0.0.0'
const NOTICE_WAIT_MS = Duration.toMillis(SYNC_NOTICE_DELAY) + 200

const laptopOn = (connection: 'online' | 'offline', agentVersion: string) =>
  liveWith(
    herd([
      machine(LAPTOP, [agent('w1:p1', 'idle', { claudeSession: SESSION })], {
        agentVersion,
        connection,
      }),
    ]),
  )

const laptop = (connection: 'online' | 'offline') => laptopOn(connection, '0.0.1')

const current = () => laptop('online')

const catchingUpPill = () => document.querySelector('[data-slot="catching-up-pill"]')

const dimmedFlags = () =>
  Array.from(document.querySelectorAll('[data-state="dimmed"]'), () => 'true')

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
  it.effect('says nothing for a quick read, and does not dim a reopened chat', () =>
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

      expect(catchingUpPill()).toBeNull()
      expect(dimmedFlags()).not.toContain('true')

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(10, 20, [said(10, 'Missed while away.')]),
        caughtUp(20),
      ])
      yield* Effect.promise(() => screen.findByText('Missed while away.'))

      expect(catchingUpPill()).toBeNull()
    }),
  )

  it.live('says so in the header once a read has run past the delay', () =>
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
      yield* Effect.sleep(Duration.millis(NOTICE_WAIT_MS))

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
    'lands a laptop catch-up at once, its divider above the first new row, when motion is reduced',
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
        expect(
          divider.compareDocumentPosition(screen.getByText('First missed.')) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).not.toBe(0)
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

  it.effect('keeps the rows it holds above a hole, and Show earlier fills the hole once', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, current())

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(0, 10, [said(0, 'Held line.')]),
        caughtUp(10),
        omittedBetween(SESSION, TranscriptOffset.make(10), TranscriptOffset.make(4096)),
        chunk(4096, 4106, [said(4096, 'Tail line.')]),
        caughtUp(4106),
      ])

      const showEarlier = yield* findByRole('button', 'Show earlier messages')
      const tail = yield* Effect.promise(() => screen.findByText('Tail line.'))
      const held = screen.getByText('Held line.')

      expect(held.compareDocumentPosition(showEarlier) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
        0,
      )
      expect(showEarlier.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
        0,
      )

      yield* click(showEarlier)
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes)).toHaveLength(2)
      })

      expect(Ref.getUnsafe(link.resumes)[1]).toEqual({ from: Option.none(), tail: Option.none() })

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(0, 4106, [said(0, 'Held line.'), said(10, 'Filled line.'), said(4096, 'Tail line.')]),
        caughtUp(4106),
      ])

      expect(yield* Effect.promise(() => screen.findByText('Filled line.'))).toBeDefined()
      expect(screen.getAllByText('Held line.')).toHaveLength(1)
      expect(screen.getAllByText('Tail line.')).toHaveLength(1)
      expect(screen.queryByRole('button', { name: 'Show earlier messages' })).toBeNull()
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

  it.live('changes the words and the rows in one commit, so the pill never leaves first', () =>
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
      yield* Effect.sleep(Duration.millis(NOTICE_WAIT_MS))

      const seen: string[] = []
      const observer = new MutationObserver(() => {
        const words = screen
          .getAllByRole('status')
          .some((status) => status.textContent === 'Catching up')

        seen.push(`${words} ${screen.queryByText('Missed while away.') !== null}`)
      })

      observer.observe(document.body, { subtree: true, childList: true, characterData: true })

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(10, 20, [said(10, 'Missed while away.')]),
        caughtUp(20),
      ])
      yield* Effect.promise(() => screen.findByText('Missed while away.'))
      yield* eventually(() => {
        expect(seen.at(-1)).toBe('false true')
      })
      observer.disconnect()

      expect(seen).not.toContain('false false')
    }),
  )

  it.effect('keeps the rows through a rejected resume on an agent too old for marks', () =>
    Effect.gen(function* () {
      const older = laptopOn('online', OLDER_AGENT)
      const { link } = yield* renderApp(CHAT, older)
      const seen: string[] = []
      const observer = new MutationObserver(() => {
        if (screen.queryByText('No messages yet') !== null) {
          seen.push('no messages')
        }
      })

      observer.observe(document.body, { subtree: true, childList: true })

      yield* Queue.offer(yield* link.transcriptFor(source), opened())
      yield* Queue.offer(yield* link.transcriptFor(source), chunk(0, 10, [said(0, 'Before.')]))
      yield* Effect.promise(() => screen.findByText('Before.'))
      yield* link.endTranscript(source, new TranscriptResumeRejected({ detail: 'the file shrank' }))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes).length).toBeGreaterThan(1)
      })
      yield* Queue.offer(yield* link.transcriptFor(source), opened())

      expect(screen.getByText('Before.')).toBeDefined()

      yield* Queue.offer(yield* link.transcriptFor(source), chunk(0, 5, [said(0, 'Rewritten.')]))
      yield* Effect.promise(() => screen.findByText('Rewritten.'))
      observer.disconnect()

      expect(seen).toEqual([])
    }),
  )

  it.effect('saves nothing on this device until a read has ended', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, laptopOn('online', OLDER_AGENT))
      const transcript = yield* link.transcriptFor(source)

      yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [said(0, 'Shown, not saved.')])])
      yield* Effect.promise(() => screen.findByText('Shown, not saved.'))

      expect(Ref.getUnsafe(link.storedTranscripts).size).toBe(0)

      yield* Queue.offer(transcript, caughtUp(10))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.storedTranscripts).size).toBe(1)
      })
    }),
  )

  it.effect('shows no "No messages yet" before the first chunk of an agent too old for marks', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, laptopOn('online', OLDER_AGENT))

      yield* Queue.offer(yield* link.transcriptFor(source), opened())
      yield* eventually(() => {
        expect(document.querySelector('[data-slot="thread-skeleton"]')).not.toBeNull()
      })

      expect(screen.queryByText('No messages yet')).toBeNull()

      yield* Queue.offer(yield* link.transcriptFor(source), chunk(0, 10, [said(0, 'First.')]))
      yield* Effect.promise(() => screen.findByText('First.'))
    }),
  )

  it.effect('offers Show earlier again on a /resume after one Show earlier', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, current())

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        omittedUpTo(SESSION, TranscriptOffset.make(10)),
        chunk(10, 20, [said(10, 'Recent line.')]),
        caughtUp(20),
      ])
      yield* click(yield* findByRole('button', 'Show earlier messages'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes)).toHaveLength(2)
      })
      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        chunk(0, 20, [said(0, 'Early line.'), said(10, 'Recent line.')]),
        caughtUp(20),
      ])
      yield* Effect.promise(() => screen.findByText('Early line.'))

      expect(Ref.getUnsafe(link.resumes)[1]?.tail).toEqual(Option.none())

      yield* Queue.offer(yield* link.transcriptFor(source), opened(NEXT_SESSION))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes)).toHaveLength(3)
      })

      const third = Ref.getUnsafe(link.resumes)[2]

      expect(third?.from).toEqual(Option.none())
      expect(Option.isSome(third?.tail ?? Option.none())).toBe(true)

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(NEXT_SESSION),
        omittedUpTo(NEXT_SESSION, TranscriptOffset.make(4096)),
        chunk(4096, 4106, [said(4096, 'The tail of the next one.')], NEXT_SESSION),
        caughtUp(4106, NEXT_SESSION),
      ])

      expect((yield* findByRole('button', 'Show earlier messages')).hasAttribute('disabled')).toBe(
        false,
      )
      expect(screen.queryByText('Early line.')).toBeNull()
    }),
  )

  it.effect('does not say Loading earlier again on a later resume', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, current())

      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        omittedUpTo(SESSION, TranscriptOffset.make(10)),
        chunk(10, 20, [said(10, 'Recent line.')]),
        caughtUp(20),
      ])
      yield* click(yield* findByRole('button', 'Show earlier messages'))
      yield* eventually(() => {
        expect(Ref.getUnsafe(link.resumes)).toHaveLength(2)
      })
      yield* Queue.offerAll(yield* link.transcriptFor(source), [
        opened(),
        omittedUpTo(SESSION, TranscriptOffset.make(5)),
        chunk(5, 20, [said(5, 'Second tail.')]),
        caughtUp(20),
      ])
      yield* Effect.promise(() => screen.findByText('Second tail.'))
      yield* link.endTranscript(source, new TranscriptReadFailed({ detail: 'hiccup' }))
      yield* click(yield* findByRole('button', 'Try again'))

      expect(screen.queryByRole('button', { name: 'Loading earlier messages' })).toBeNull()
    }),
  )

  it.effect('tells a closed pane with nothing cached so, instead of a blank thread', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(CHAT, current())

      yield* eventually(() => {
        expect(document.querySelector('[data-slot="thread-skeleton"]')).not.toBeNull()
      })
      yield* SubscriptionRef.set(link.state, liveWith(herd([machine(LAPTOP, [])])))

      yield* Effect.promise(() => screen.findByText('No messages on this phone yet'))
    }),
  )
})
