import { describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as TestClock from 'effect/testing/TestClock'

import { AgentStarted, StartAgent } from '@crook/domain/Command'
import { IdempotencyKey, PaneId, TranscriptOffset } from '@crook/domain/Ids'
import { PaneTranscript, positionAfter, TranscriptPosition } from '@crook/domain/Transcript'
import type { TranscriptEvent } from '@crook/domain/Transcript'
import { AGENT_PING_INTERVAL, HUB_RECONNECT_BASE } from '@crook/protocol/AgentLink'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { connectionView } from '@crook/web/connection/ConnectionView'
import { HubCallDefected, HubConnectionLost } from '@crook/web/rpc/HubConnection'
import {
  HubLink,
  HubNotConnected,
  RECOVERED_NOTICE_DURATION,
  SYNC_NOTICE_DELAY,
} from '@crook/web/rpc/HubLink'
import { COLD_START, LinkStatus, QUIET_DIALING } from '@crook/web/rpc/HubLinkState'
import type { HubLinkState } from '@crook/web/rpc/HubLinkState'
import { SESSION_CHECK_TIMEOUT } from '@crook/web/rpc/SessionCheck'

import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { dropSession, makeFakeBrowser } from '../HubFakes.ts'
import { chunk, opened, prompt, said, SESSION } from '../TranscriptFixtures.ts'
import type { FakeSession } from '../HubFakes.ts'

const SETTLE_STEPS = 50

const cachedView = herd([machine(LAPTOP, [agent('w1:p1', 'working')])])
const liveView = herd([machine(LAPTOP, [agent('w1:p1', 'done')])])
const refused = new HubConnectionLost({ detail: 'connection refused' })

const isDialing = LinkStatus.$is('Dialing')
const isLive = LinkStatus.$is('Live')

const start = Effect.fn('start')(function* (cached: Option.Option<HerdSnapshot> = Option.none()) {
  const browser = yield* makeFakeBrowser(cached)
  const context = yield* Layer.build(Layer.provide(HubLink.layerWithoutBrowser, browser.layer))
  const link = Context.get(context, HubLink)
  const latest = yield* Ref.make(Option.none<HubLinkState>())

  yield* link.changes.pipe(
    Stream.runForEach((state) => Ref.set(latest, Option.some(state))),
    Effect.forkScoped,
  )

  const settle = Effect.repeat(Effect.yieldNow, { times: SETTLE_STEPS })

  const current = Effect.andThen(
    settle,
    Effect.flatMap(Ref.get(latest), (state) => Effect.fromOption(state)),
  )

  const nextSession: Effect.Effect<FakeSession> = Effect.andThen(
    settle,
    Queue.take(browser.sessions),
  )

  return { browser, link, current, settle, nextSession }
})

describe('HubLink', () => {
  it.effect('paints the cached herd at once, dimmed, before the hub answers', () =>
    Effect.gen(function* () {
      const cached = new HerdSnapshot({ view: cachedView, syncedAt: START })
      const { current } = yield* start(Option.some(cached))
      const state = yield* current

      expect(Option.getOrThrow(state.herd).view).toBe(cachedView)
      expect(state.status).toEqual(COLD_START)
      expect(connectionView(state).stale).toBe(true)
    }),
  )

  it.effect('goes live on the first herd and caches it', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const session = yield* nextSession

      yield* Queue.offer(session.views, liveView)
      const state = yield* current

      expect(state.status).toEqual(LinkStatus.Live({ recovered: false }))
      expect(Option.getOrThrow(state.herd).view).toBe(liveView)
      expect(Option.map(yield* Ref.get(browser.saved), (saved) => saved.view)).toEqual(
        Option.some(liveView),
      )
    }),
  )

  it.effect('announces a sync only after it has taken a second', () =>
    Effect.gen(function* () {
      const { current, nextSession } = yield* start()

      yield* nextSession
      yield* TestClock.adjust(Duration.subtract(SYNC_NOTICE_DELAY, Duration.millis(1)))

      expect((yield* current).status).toEqual(COLD_START)

      yield* TestClock.adjust(Duration.millis(1))

      expect((yield* current).status).toEqual(
        LinkStatus.Dialing({ announced: true, afterFailure: false, coldStart: true }),
      )
    }),
  )

  it.effect('keeps the sync notice timer running while a failed dial checks the session', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const first = yield* nextSession

      yield* Ref.set(browser.sessionCheckTakes, Option.some(SESSION_CHECK_TIMEOUT))
      yield* dropSession(first, refused)

      expect((yield* current).status).toEqual(COLD_START)

      yield* TestClock.adjust(SYNC_NOTICE_DELAY)

      expect((yield* current).status).toEqual(
        LinkStatus.Dialing({ announced: true, afterFailure: false, coldStart: true }),
      )

      yield* TestClock.adjust(SESSION_CHECK_TIMEOUT)

      expect((yield* current).status).toEqual(LinkStatus.Unreachable())
    }),
  )

  it.effect('resyncs silently when the page comes back and the hub answers quickly', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const first = yield* nextSession

      yield* Queue.offer(first.views, cachedView)
      yield* current
      yield* SubscriptionRef.set(browser.visible, false)

      expect(yield* Ref.get(browser.closed)).toBe(0)

      yield* current

      expect(yield* Ref.get(browser.closed)).toBe(1)

      yield* SubscriptionRef.set(browser.visible, true)
      const second = yield* nextSession

      expect((yield* current).status).toEqual(QUIET_DIALING)

      yield* Queue.offer(second.views, liveView)
      yield* TestClock.adjust(SYNC_NOTICE_DELAY)

      expect((yield* current).status).toEqual(LinkStatus.Live({ recovered: false }))
    }),
  )

  it.effect('shows the hub unreachable, retries on the backoff and says when it is back', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const first = yield* nextSession

      yield* dropSession(first, refused)

      expect((yield* current).status).toEqual(LinkStatus.Unreachable())
      expect(yield* Ref.get(browser.opened)).toBe(1)

      yield* TestClock.adjust(HUB_RECONNECT_BASE)
      const second = yield* nextSession

      expect((yield* current).status).toEqual(LinkStatus.Unreachable())

      yield* Queue.offer(second.views, liveView)

      expect((yield* current).status).toEqual(LinkStatus.Live({ recovered: true }))

      yield* TestClock.adjust(RECOVERED_NOTICE_DURATION)

      expect((yield* current).status).toEqual(LinkStatus.Live({ recovered: false }))
    }),
  )

  it.effect('reconnects at once when a healthy connection drops', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const first = yield* nextSession

      yield* Queue.offer(first.views, liveView)
      yield* current
      yield* TestClock.adjust(AGENT_PING_INTERVAL)
      yield* dropSession(first, refused)
      yield* nextSession

      expect(yield* Ref.get(browser.opened)).toBe(2)
      expect(isDialing((yield* current).status)).toBe(true)
    }),
  )

  it.effect('shows the logged-out screen when the proxy says the session expired', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const first = yield* nextSession

      yield* Ref.set(browser.expired, true)
      yield* dropSession(first, refused)

      expect((yield* current).status).toEqual(LinkStatus.Expired())

      yield* TestClock.adjust(AGENT_PING_INTERVAL)

      expect(yield* Ref.get(browser.opened)).toBe(1)

      yield* SubscriptionRef.set(browser.visible, false)
      yield* Ref.set(browser.expired, false)
      yield* SubscriptionRef.set(browser.visible, true)
      const second = yield* nextSession

      expect((yield* current).status).toEqual(LinkStatus.Expired())

      yield* Queue.offer(second.views, liveView)

      expect(isLive((yield* current).status)).toBe(true)
    }),
  )

  it.effect('tells offline apart and syncs at once when the network returns', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const first = yield* nextSession

      yield* Queue.offer(first.views, liveView)
      yield* current
      yield* SubscriptionRef.set(browser.online, false)

      expect((yield* current).status).toEqual(LinkStatus.Offline())
      expect(yield* Ref.get(browser.closed)).toBe(1)

      yield* SubscriptionRef.set(browser.online, true)
      const second = yield* nextSession

      expect((yield* current).status).toEqual(
        LinkStatus.Dialing({ announced: true, afterFailure: true, coldStart: false }),
      )

      yield* Queue.offer(second.views, liveView)

      expect((yield* current).status).toEqual(LinkStatus.Live({ recovered: true }))
    }),
  )

  it.effect('marks seen only over a live connection and queues nothing', () =>
    Effect.gen(function* () {
      const { browser, link, nextSession, settle } = yield* start()
      const pane = agent('w1:p1', 'done').pane

      yield* SubscriptionRef.set(browser.online, false)
      yield* settle
      const refusedOffline = yield* Effect.flip(link.markSeen(LAPTOP, pane))

      expect(refusedOffline.message).toContain('nothing is queued')

      yield* SubscriptionRef.set(browser.online, true)
      const session = yield* nextSession

      yield* Queue.offer(session.views, liveView)
      yield* settle
      yield* link.markSeen(LAPTOP, pane)

      expect(yield* Ref.get(browser.seen)).toEqual([{ machine: LAPTOP, pane }])
    }),
  )

  it.effect('forgets a machine only over a live connection', () =>
    Effect.gen(function* () {
      const { browser, link, nextSession, settle } = yield* start()
      const session = yield* nextSession
      const beforeTheHerd = yield* Effect.flip(link.forgetMachine(LAPTOP))

      expect(beforeTheHerd).toBeInstanceOf(HubNotConnected)

      yield* Queue.offer(session.views, liveView)
      yield* settle
      yield* link.forgetMachine(LAPTOP)

      expect(yield* Ref.get(browser.forgotten)).toEqual([LAPTOP])
    }),
  )

  it.effect('sends a command only over a live connection', () =>
    Effect.gen(function* () {
      const { browser, link, nextSession, settle } = yield* start()
      const receipt = new AgentStarted({ pane: agent('w1:p9', 'idle').pane })
      const command = new StartAgent({
        kind: 'claude',
        folder: '/home/jliocsar/Projects/crook',
        task: Option.none(),
      })
      const key = IdempotencyKey.make('5b0e7d21')
      const session = yield* nextSession
      const beforeTheHerd = yield* Effect.flip(link.sendCommand(LAPTOP, key, command))

      expect(beforeTheHerd).toBeInstanceOf(HubNotConnected)

      yield* Ref.set(browser.commandAnswer, Exit.succeed(receipt))
      yield* Queue.offer(session.views, liveView)
      yield* settle

      expect(yield* link.sendCommand(LAPTOP, key, command)).toEqual(receipt)
      expect(yield* Ref.get(browser.sent)).toEqual([{ machine: LAPTOP, key, command }])
    }),
  )

  it.effect('refuses hub calls until the herd has arrived over the socket', () =>
    Effect.gen(function* () {
      const { browser, link, nextSession, settle } = yield* start()
      const pane = agent('w1:p1', 'done').pane
      const session = yield* nextSession
      const beforeTheHerd = yield* Effect.flip(link.markSeen(LAPTOP, pane))

      expect(beforeTheHerd).toBeInstanceOf(HubNotConnected)
      expect(yield* Ref.get(browser.seen)).toEqual([])

      yield* Queue.offer(session.views, liveView)
      yield* settle
      yield* link.markSeen(LAPTOP, pane)

      expect(yield* Ref.get(browser.seen)).toEqual([{ machine: LAPTOP, pane }])
    }),
  )

  it.effect('treats a hub call that died as a failed dial and dials again', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const first = yield* nextSession

      yield* dropSession(first, new HubCallDefected({ cause: 'undecodable chunk' }))

      expect((yield* current).status).toEqual(LinkStatus.Unreachable())

      yield* TestClock.adjust(HUB_RECONNECT_BASE)
      yield* nextSession

      expect(yield* Ref.get(browser.opened)).toBe(2)
    }),
  )

  it.effect('surfaces a defect that kills the link instead of freezing on it', () =>
    Effect.gen(function* () {
      const { link, nextSession, settle } = yield* start()
      const watching = yield* Effect.forkChild(Stream.runDrain(link.changes))
      const first = yield* nextSession

      yield* Queue.failCause(first.views, Cause.die('a bug in the link'))
      yield* settle
      const exit = watching.pollUnsafe()

      expect(exit !== undefined && Exit.hasDies(exit)).toBe(true)
    }),
  )

  it.effect('resumes a transcript watch on the next connection from where the phone stands', () =>
    Effect.gen(function* () {
      const { link, current, nextSession, settle } = yield* start()
      const first = yield* nextSession
      const position = yield* Ref.make(Option.none<TranscriptPosition>())
      const received = yield* Ref.make<readonly TranscriptEvent[]>([])

      yield* Queue.offer(first.views, liveView)
      yield* current
      yield* TestClock.adjust(AGENT_PING_INTERVAL)
      yield* link
        .watchTranscript(
          LAPTOP,
          new PaneTranscript({ pane: PaneId.make('w1:p1') }),
          Effect.map(Ref.get(position), (from) => ({ from, tail: Option.none() })),
        )
        .pipe(
          Stream.runForEach((event) =>
            Effect.andThen(
              Ref.update(received, (events) => [...events, event]),
              Ref.update(position, (held) => positionAfter(held, event)),
            ),
          ),
          Effect.forkScoped,
        )
      const firstWatch = yield* Effect.andThen(settle, Queue.take(first.transcripts))

      yield* Queue.offer(firstWatch, opened())
      yield* Queue.offer(firstWatch, chunk(0, 10, [prompt(0, 'hi')]))
      yield* settle
      yield* Queue.fail(firstWatch, refused)
      yield* dropSession(first, refused)
      const second = yield* nextSession

      yield* Queue.offer(second.views, liveView)
      const secondWatch = yield* Effect.andThen(settle, Queue.take(second.transcripts))

      yield* Queue.offer(secondWatch, chunk(10, 20, [said(10, 'hello')]))
      yield* settle

      expect((yield* Ref.get(first.transcriptRequests)).map((request) => request.from)).toEqual([
        Option.none(),
      ])
      expect((yield* Ref.get(second.transcriptRequests)).map((request) => request.from)).toEqual([
        Option.some(
          new TranscriptPosition({ session: SESSION, offset: TranscriptOffset.make(10) }),
        ),
      ])
      expect(yield* Ref.get(received)).toHaveLength(3)
    }),
  )

  it.effect('resyncs on a fresh connection and finishes once the new herd arrives', () =>
    Effect.gen(function* () {
      const { browser, link, current, nextSession } = yield* start()
      const first = yield* nextSession

      yield* Queue.offer(first.views, cachedView)
      yield* current
      yield* TestClock.adjust(Duration.seconds(1))
      const resynced = yield* Effect.forkChild(link.resync)
      const second = yield* nextSession

      expect(yield* Ref.get(browser.closed)).toBe(1)
      expect(resynced.pollUnsafe()).toBeUndefined()

      yield* TestClock.adjust(Duration.millis(1))
      yield* Queue.offer(second.views, liveView)
      yield* current

      expect(resynced.pollUnsafe()).toBeDefined()
    }),
  )
})
