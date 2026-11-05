import { describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Latch from 'effect/Latch'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as TestClock from 'effect/testing/TestClock'

import { AgentStarted, StartAgent } from '@crook/domain/Command'
import { IdempotencyKey, PaneId, TranscriptOffset } from '@crook/domain/Ids'
import { defaultNotificationPrefs, NotificationSettings } from '@crook/domain/Notifications'
import { PaneTranscript, positionAfter, TranscriptPosition } from '@crook/domain/Transcript'
import type { TranscriptEvent } from '@crook/domain/Transcript'
import { AGENT_PING_INTERVAL, HUB_RECONNECT_BASE, RECONNECT_CAP } from '@crook/protocol/AgentLink'
import { HubAccount } from '@crook/protocol/ClientApi'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { connectionView, dimsContent } from '@crook/web/connection/ConnectionView'
import { HubCallDefected, HubConnectionLost } from '@crook/web/rpc/HubConnection'
import {
  CALL_HOLD_LIMIT,
  HubLink,
  HubNotConnected,
  RECOVERED_NOTICE_DURATION,
} from '@crook/web/rpc/HubLink'
import { NOTICE_DELAY } from '@crook/web/machine/NoticeTiming'
import {
  ANNOUNCED,
  COLD_START,
  EXPIRED,
  LinkStatus,
  LIVE,
  LOGGED_OUT,
  OFFLINE,
  PARKED,
  RECOVERED,
  REDIALING,
  RETURNING,
  UNREACHABLE,
} from '@crook/web/rpc/HubLinkState'
import type { HubLinkState } from '@crook/web/rpc/HubLinkState'
import { LogOutRefused, SESSION_CHECK_TIMEOUT } from '@crook/web/rpc/SessionCheck'

import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { dropSession, makeFakeBrowser, OWNER_EMAIL, readySettings } from '../HubFakes.ts'
import { chunk, opened, prompt, said, SESSION } from '../TranscriptFixtures.ts'
import type { FakeSession } from '../HubFakes.ts'

const SETTLE_STEPS = 50

const cachedView = herd([machine(LAPTOP, [agent('w1:p1', 'working')])])
const liveView = herd([machine(LAPTOP, [agent('w1:p1', 'done')])])
const laterView = herd([machine(LAPTOP, [agent('w1:p1', 'idle')])])
const redialingView = herd([
  machine(LAPTOP, [agent('w1:p1', 'done')], { connection: 'reconnecting' }),
])
const refused = new HubConnectionLost({ detail: 'connection refused' })

const isDialing = LinkStatus.isAnyOf(['ColdStart', 'Redialing', 'Announced', 'Returning'])
const isLive = LinkStatus.guards.Live

const start = Effect.fn('start')(function* (cached: Option.Option<HerdSnapshot> = Option.none()) {
  const browser = yield* makeFakeBrowser(cached)
  const context = yield* Layer.build(Layer.provide(HubLink.layer, browser.layer))
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
  it.effect('paints the cached herd at once, undimmed, before the hub answers', () =>
    Effect.gen(function* () {
      const cached = new HerdSnapshot({ view: cachedView, syncedAt: START })
      const { current } = yield* start(Option.some(cached))
      const state = yield* current

      expect(Option.getOrThrow(state.herd).view).toBe(cachedView)
      expect(state.status).toEqual(COLD_START)
      expect(dimsContent(connectionView(state))).toBe(false)
    }),
  )

  it.effect('goes live on the first herd and caches it', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const session = yield* nextSession

      yield* Queue.offer(session.views, liveView)
      const state = yield* current

      expect(state.status).toEqual(LIVE)
      expect(Option.getOrThrow(state.herd).view).toBe(liveView)
      expect(Option.map(yield* Ref.get(browser.saved), (saved) => saved.view)).toEqual(
        Option.some(liveView),
      )
    }),
  )

  it.effect('takes every herd update while a cache write is out, then caches only the latest', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession, settle } = yield* start()
      const session = yield* nextSession

      yield* browser.saveAnswers.close
      yield* Queue.offer(session.views, cachedView)
      yield* current
      yield* Queue.offer(session.views, liveView)
      yield* Queue.offer(session.views, laterView)
      const state = yield* current

      expect(Option.getOrThrow(state.herd).view).toBe(laterView)
      expect(yield* Ref.get(browser.saves)).toBe(0)

      yield* browser.saveAnswers.open
      yield* settle

      expect(Option.map(yield* Ref.get(browser.saved), (saved) => saved.view)).toEqual(
        Option.some(laterView),
      )
      expect(yield* Ref.get(browser.saves)).toBe(2)
    }),
  )

  it.effect('keeps caching the herd after a write that died', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession, settle } = yield* start()
      const session = yield* nextSession

      yield* Ref.set(browser.saveDies, true)
      yield* Queue.offer(session.views, cachedView)
      yield* current
      yield* Queue.offer(session.views, liveView)
      yield* current
      yield* settle

      expect(Option.map(yield* Ref.get(browser.saved), (saved) => saved.view)).toEqual(
        Option.some(liveView),
      )
    }),
  )

  it.effect('forgets the herd on logout even when a cache write was still out', () =>
    Effect.gen(function* () {
      const { browser, link, current, nextSession, settle } = yield* start()
      const session = yield* nextSession

      yield* browser.saveAnswers.close
      yield* Queue.offer(session.views, liveView)
      yield* current
      const loggingOut = yield* Effect.forkChild(link.logOut, { startImmediately: true })

      yield* settle
      yield* browser.saveAnswers.open
      yield* Fiber.join(loggingOut)
      yield* settle

      expect((yield* current).herd).toEqual(Option.none())
      expect(yield* Ref.get(browser.saved)).toEqual(Option.none())
    }),
  )

  it.effect('announces a sync only after it has taken a second', () =>
    Effect.gen(function* () {
      const { current, nextSession } = yield* start()

      yield* nextSession
      yield* TestClock.adjust(Duration.subtract(NOTICE_DELAY, Duration.millis(1)))

      expect((yield* current).status).toEqual(COLD_START)

      yield* TestClock.adjust(Duration.millis(1))

      expect((yield* current).status).toEqual(ANNOUNCED)
    }),
  )

  it.effect('keeps the sync notice timer running while a failed dial checks the session', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const first = yield* nextSession

      yield* Ref.set(browser.sessionCheckTakes, Option.some(SESSION_CHECK_TIMEOUT))
      yield* dropSession(first, refused)

      expect((yield* current).status).toEqual(COLD_START)

      yield* TestClock.adjust(NOTICE_DELAY)

      expect((yield* current).status).toEqual(ANNOUNCED)

      yield* TestClock.adjust(SESSION_CHECK_TIMEOUT)

      expect((yield* current).status).toEqual(UNREACHABLE)
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
      expect((yield* current).status).toEqual(PARKED)
      expect(yield* Ref.get(browser.closed)).toBe(1)

      yield* SubscriptionRef.set(browser.visible, true)
      const second = yield* nextSession

      expect((yield* current).status).toEqual(REDIALING)

      yield* Queue.offer(second.views, liveView)
      yield* TestClock.adjust(NOTICE_DELAY)

      expect((yield* current).status).toEqual(LIVE)
    }),
  )

  it.effect('shows the hub unreachable, retries on the backoff and says when it is back', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const first = yield* nextSession

      yield* dropSession(first, refused)

      expect((yield* current).status).toEqual(UNREACHABLE)
      expect(yield* Ref.get(browser.opened)).toBe(1)

      yield* TestClock.adjust(HUB_RECONNECT_BASE)
      const second = yield* nextSession

      expect((yield* current).status).toEqual(UNREACHABLE)

      yield* Queue.offer(second.views, liveView)

      expect((yield* current).status).toEqual(RECOVERED)

      yield* TestClock.adjust(RECOVERED_NOTICE_DURATION)

      expect((yield* current).status).toEqual(LIVE)
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

      expect((yield* current).status).toEqual(EXPIRED)

      yield* TestClock.adjust(AGENT_PING_INTERVAL)

      expect(yield* Ref.get(browser.opened)).toBe(1)

      yield* SubscriptionRef.set(browser.visible, false)
      yield* Ref.set(browser.expired, false)
      yield* SubscriptionRef.set(browser.visible, true)
      const second = yield* nextSession

      expect((yield* current).status).toEqual(EXPIRED)

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

      expect((yield* current).status).toEqual(OFFLINE)
      expect(yield* Ref.get(browser.closed)).toBe(1)

      yield* SubscriptionRef.set(browser.online, true)
      const second = yield* nextSession

      expect((yield* current).status).toEqual(RETURNING)

      yield* Queue.offer(second.views, liveView)

      expect((yield* current).status).toEqual(RECOVERED)
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

  it.effect('holds a forget through the first dial and makes it once connected', () =>
    Effect.gen(function* () {
      const { browser, link, nextSession, settle } = yield* start()
      const session = yield* nextSession
      const held = yield* Effect.forkChild(link.forgetMachine(LAPTOP))

      yield* settle

      expect(yield* Ref.get(browser.forgotten)).toEqual([])

      yield* Queue.offer(session.views, liveView)
      yield* Fiber.join(held)

      expect(yield* Ref.get(browser.forgotten)).toEqual([LAPTOP])
    }),
  )

  it.effect('holds a command through the first dial and sends it once connected', () =>
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

      yield* Ref.set(browser.commandAnswer, Exit.succeed(receipt))
      const held = yield* Effect.forkChild(link.sendCommand(LAPTOP, key, command))

      yield* settle

      expect(yield* Ref.get(browser.sent)).toEqual([])

      yield* Queue.offer(session.views, liveView)

      expect(yield* Fiber.join(held)).toEqual(receipt)
      expect(yield* Ref.get(browser.sent)).toEqual([{ machine: LAPTOP, key, command }])
    }),
  )

  it.effect('holds a command while its machine redials and sends it once the machine is back', () =>
    Effect.gen(function* () {
      const { browser, link, nextSession, settle } = yield* start()
      const command = new StartAgent({
        kind: 'claude',
        folder: '/home/jliocsar/Projects/crook',
        task: Option.none(),
      })
      const key = IdempotencyKey.make('5b0e7d22')
      const receipt = new AgentStarted({ pane: agent('w1:p9', 'idle').pane })
      const session = yield* nextSession

      yield* Ref.set(browser.commandAnswer, Exit.succeed(receipt))
      yield* Queue.offer(session.views, redialingView)
      yield* settle
      const held = yield* Effect.forkChild(link.sendCommand(LAPTOP, key, command))

      yield* settle

      expect(yield* Ref.get(browser.sent)).toEqual([])

      yield* Queue.offer(session.views, liveView)

      expect(yield* Fiber.join(held)).toEqual(receipt)
      expect(yield* Ref.get(browser.sent)).toEqual([{ machine: LAPTOP, key, command }])
    }),
  )

  it.effect('lets the hub answer for a machine still away once the hold runs out', () =>
    Effect.gen(function* () {
      const { browser, link, nextSession, settle } = yield* start()
      const command = new StartAgent({
        kind: 'claude',
        folder: '/home/jliocsar/Projects/crook',
        task: Option.none(),
      })
      const key = IdempotencyKey.make('5b0e7d23')
      const receipt = new AgentStarted({ pane: agent('w1:p9', 'idle').pane })
      const session = yield* nextSession

      yield* Ref.set(browser.commandAnswer, Exit.succeed(receipt))
      yield* Queue.offer(session.views, redialingView)
      yield* settle
      const held = yield* Effect.forkChild(link.sendCommand(LAPTOP, key, command))

      yield* settle
      yield* TestClock.adjust(CALL_HOLD_LIMIT)

      expect(yield* Fiber.join(held)).toEqual(receipt)
      expect(yield* Ref.get(browser.sent)).toEqual([{ machine: LAPTOP, key, command }])
    }),
  )

  it.effect('gives a send one hold, through a machine away and a link down together', () =>
    Effect.gen(function* () {
      const { browser, link, nextSession, settle } = yield* start()
      const command = new StartAgent({
        kind: 'claude',
        folder: '/home/jliocsar/Projects/crook',
        task: Option.none(),
      })
      const first = yield* nextSession

      yield* Queue.offer(first.views, redialingView)
      yield* settle
      yield* TestClock.adjust(RECONNECT_CAP)
      const held = yield* Effect.forkChild(
        Effect.flip(link.sendCommand(LAPTOP, IdempotencyKey.make('5b0e7d24'), command)),
      )

      yield* settle
      yield* dropSession(first, refused)
      yield* TestClock.adjust(HUB_RECONNECT_BASE)
      yield* nextSession
      yield* settle
      yield* TestClock.adjust(CALL_HOLD_LIMIT)

      expect(yield* Fiber.join(held)).toBeInstanceOf(HubNotConnected)
      expect(yield* Ref.get(browser.sent)).toEqual([])
    }),
  )

  it.effect('holds a call through a quiet redial and makes it on the new connection', () =>
    Effect.gen(function* () {
      const { browser, link, nextSession, settle } = yield* start()
      const pane = agent('w1:p1', 'done').pane
      const first = yield* nextSession

      yield* Queue.offer(first.views, liveView)
      yield* settle
      yield* TestClock.adjust(RECONNECT_CAP)
      yield* dropSession(first, refused)
      const held = yield* Effect.forkChild(link.markSeen(LAPTOP, pane))

      yield* TestClock.adjust(HUB_RECONNECT_BASE)
      const second = yield* nextSession

      expect(yield* Ref.get(browser.seen)).toEqual([])

      yield* Queue.offer(second.views, liveView)
      yield* Fiber.join(held)

      expect(yield* Ref.get(browser.seen)).toEqual([{ machine: LAPTOP, pane }])
    }),
  )

  it.effect('holds a call while the page is hidden and makes it once shown', () =>
    Effect.gen(function* () {
      const { browser, current, link, nextSession, settle } = yield* start()
      const pane = agent('w1:p1', 'done').pane
      const first = yield* nextSession

      yield* Queue.offer(first.views, liveView)
      yield* settle
      yield* SubscriptionRef.set(browser.visible, false)

      expect((yield* current).status).toEqual(PARKED)

      const held = yield* Effect.forkChild(link.markSeen(LAPTOP, pane))

      yield* settle
      yield* SubscriptionRef.set(browser.visible, true)
      const second = yield* nextSession

      yield* Queue.offer(second.views, liveView)
      yield* Fiber.join(held)

      expect(yield* Ref.get(browser.seen)).toEqual([{ machine: LAPTOP, pane }])
    }),
  )

  it.effect('refuses a held call the moment the dial fails', () =>
    Effect.gen(function* () {
      const { link, nextSession, settle } = yield* start()
      const pane = agent('w1:p1', 'done').pane
      const first = yield* nextSession
      const held = yield* Effect.forkChild(Effect.flip(link.markSeen(LAPTOP, pane)))

      yield* settle
      yield* dropSession(first, refused)

      expect(yield* Fiber.join(held)).toBeInstanceOf(HubNotConnected)
    }),
  )

  it.effect('gives up on a held call when the dial never answers', () =>
    Effect.gen(function* () {
      const { link, nextSession, settle } = yield* start()
      const pane = agent('w1:p1', 'done').pane

      yield* nextSession
      const held = yield* Effect.forkChild(Effect.flip(link.markSeen(LAPTOP, pane)))

      yield* settle
      yield* TestClock.adjust(CALL_HOLD_LIMIT)

      expect(yield* Fiber.join(held)).toBeInstanceOf(HubNotConnected)
    }),
  )

  it.effect('treats a hub call that died as a failed dial and dials again', () =>
    Effect.gen(function* () {
      const { browser, current, nextSession } = yield* start()
      const first = yield* nextSession

      yield* dropSession(first, new HubCallDefected({ cause: 'undecodable chunk' }))

      expect((yield* current).status).toEqual(UNREACHABLE)

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

  it.effect('follows the notification switches across a reconnect, never failing on a drop', () =>
    Effect.gen(function* () {
      const { link, nextSession, settle } = yield* start()
      const watched = yield* Ref.make<readonly NotificationSettings[]>([])
      const noToken = new NotificationSettings({
        prefs: { ...defaultNotificationPrefs, finished: false },
        delivery: 'noToken',
      })

      yield* link.notificationSettings.pipe(
        Stream.runForEach((settings) => Ref.update(watched, (all) => [...all, settings])),
        Effect.forkScoped,
      )
      const first = yield* nextSession

      yield* Queue.offer(first.views, liveView)
      yield* settle
      yield* Queue.offer(first.settings, readySettings)
      yield* settle
      yield* dropSession(first, refused)
      yield* TestClock.adjust(HUB_RECONNECT_BASE)
      const second = yield* nextSession

      yield* Queue.offer(second.views, liveView)
      yield* settle
      yield* Queue.offer(second.settings, noToken)
      yield* settle

      expect(yield* Ref.get(watched)).toEqual([readySettings, noToken])
    }),
  )

  it.effect('reads the account once the connection is live', () =>
    Effect.gen(function* () {
      const { link, nextSession, settle } = yield* start()
      const account = yield* Effect.forkChild(link.account.pipe(Stream.runHead))
      const session = yield* nextSession

      yield* Queue.offer(session.views, liveView)
      yield* settle

      expect(account.pollUnsafe()).toEqual(
        Exit.succeed(Option.some(new HubAccount({ email: OWNER_EMAIL }))),
      )
    }),
  )

  it.effect('holds a switch and a test through the first dial', () =>
    Effect.gen(function* () {
      const { browser, link, nextSession, settle } = yield* start()
      const session = yield* nextSession
      const heldPref = yield* Effect.forkChild(link.setNotificationPref('finished', false))
      const heldTest = yield* Effect.forkChild(link.sendTestNotification)

      yield* settle

      expect(yield* Ref.get(browser.prefWrites)).toEqual([])

      yield* Queue.offer(session.views, liveView)
      yield* Fiber.join(heldPref)
      yield* Fiber.join(heldTest)

      expect(yield* Ref.get(browser.prefWrites)).toEqual([{ event: 'finished', enabled: false }])
    }),
  )

  it.effect('logs out: ends the exe.dev session, closes the socket and forgets the herd', () =>
    Effect.gen(function* () {
      const { browser, link, current, nextSession, settle } = yield* start()
      const session = yield* nextSession

      yield* Queue.offer(session.views, liveView)
      yield* current
      yield* link.logOut
      const state = yield* current

      expect(state.status).toEqual(LOGGED_OUT)
      expect(state.herd).toEqual(Option.none())
      expect(yield* Ref.get(browser.logOuts)).toBe(1)
      expect(yield* Ref.get(browser.closed)).toBe(1)
      expect(yield* Ref.get(browser.saved)).toEqual(Option.none())

      yield* SubscriptionRef.set(browser.visible, false)
      yield* SubscriptionRef.set(browser.visible, true)
      yield* TestClock.adjust(AGENT_PING_INTERVAL)
      yield* settle

      expect(yield* Ref.get(browser.opened)).toBe(1)
      expect((yield* current).status).toEqual(LOGGED_OUT)
    }),
  )

  it.effect(
    'closes the socket before it forgets the herd, so a late update cannot cache it again',
    () =>
      Effect.gen(function* () {
        const { browser, link, current, nextSession } = yield* start()
        const session = yield* nextSession

        yield* Queue.offer(session.views, cachedView)
        yield* current
        yield* Ref.set(browser.whileLoggingOut, Queue.offer(session.views, liveView))
        yield* link.logOut

        expect(yield* Ref.get(browser.closed)).toBe(1)
        expect(yield* Ref.get(browser.saved)).toEqual(Option.none())

        yield* Queue.offer(session.views, liveView)
        const state = yield* current

        expect(state.herd).toEqual(Option.none())
        expect(yield* Ref.get(browser.saved)).toEqual(Option.none())
      }),
  )

  it.effect('finishes a logout it started even when whoever asked for it goes away', () =>
    Effect.gen(function* () {
      const { browser, link, current, nextSession } = yield* start()
      const session = yield* nextSession
      const exeDevAnswers = yield* Latch.make(false)

      yield* Queue.offer(session.views, liveView)
      yield* current
      yield* Ref.set(browser.whileLoggingOut, exeDevAnswers.await)
      const attempt = yield* Effect.forkChild(link.logOut, { startImmediately: true })

      yield* Effect.forkChild(Fiber.interrupt(attempt), { startImmediately: true })
      yield* exeDevAnswers.open
      const state = yield* current

      expect(state.status).toEqual(LOGGED_OUT)
      expect(yield* Ref.get(browser.saved)).toEqual(Option.none())
      expect(yield* Ref.get(browser.closed)).toBe(1)
    }),
  )

  it.effect('stays connected with the herd cached when exe.dev refuses the logout', () =>
    Effect.gen(function* () {
      const { browser, link, current, nextSession } = yield* start()
      const session = yield* nextSession
      const refusal = new LogOutRefused({ status: 404 })

      yield* Ref.set(browser.logOutRefusal, Option.some(refusal))
      yield* Queue.offer(session.views, liveView)
      yield* current
      const failure = yield* Effect.flip(link.logOut)

      expect(failure).toEqual(refusal)
      expect(isLive((yield* current).status)).toBe(true)
      expect(Option.isSome(yield* Ref.get(browser.saved))).toBe(true)
      expect(yield* Ref.get(browser.closed)).toBe(0)
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
