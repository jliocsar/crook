import { expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as SqlClient from 'effect/sql/SqlClient'
import * as TestClock from 'effect/testing/TestClock'

import type { AgentRow } from '@crook/domain/AgentRow'
import { InputDelivered } from '@crook/domain/Command'
import { AskId, MachineId, PaneId, TerminalId } from '@crook/domain/Ids'
import type { MachineState } from '@crook/domain/MachineState'
import { HubAuditRecord } from '@crook/hub/AuditTrail'
import { CommandRouter } from '@crook/hub/CommandRouter'
import * as Database from '@crook/hub/Database'
import { HarkNotifier } from '@crook/hub/HarkNotifier'
import { Herd } from '@crook/hub/Herd'
import { AGENT_PATH } from '@crook/protocol/HubRoutes'
import { AgentLink, Hello } from '@crook/protocol/AgentLink'
import { AskNotPending, type RoutedCommand } from '@crook/protocol/Commands'

import {
  PANE,
  agentRow,
  agentToken,
  bashAsk,
  connect,
  crookWorkspace,
  harkServicesUnder,
  hello,
  herdrLinkOf,
  hubOverHark,
  machineStateWith,
} from './Fixtures'
import {
  HARK_TOKEN,
  type HarkCall,
  type HarkScript,
  acceptingHark,
  advancingClock,
  fakeHark,
  interactionCreated,
  interactionRespondedTo,
  interactionWaited,
  isAskCreation,
  isCancel,
  isWait,
  nextCallWhere,
} from './HarkFakes'

interface HarkPrompt {
  said: string
  readonly respondedAt: Option.Option<string>
}

const IN_MEMORY = ':memory:'
const INTERACTION_ID = 'int_7MFuml'
const SCREEN_ASK = 'screen-same-dialog'
const TIME_FOR_FIBERS = '20 millis'
const ASKED_SEQ = 7
const NEXT_ASK_SEQ = 9
const A_DAY_LESS_AN_HOUR = 23
const SOCKET_TEST_LIMIT_MILLIS = 30_000
const ANSWERED_AT_THE_START = '1970-01-01T00:00:00.000Z'
const LAPTOP = MachineId.make('laptop')
const OTHER_PANE = PaneId.make('w1:p9')
const THE_ANSWER_ID = AskId.make(SCREEN_ASK)
const OLDER_HELLO = new Hello({ agentVersion: '0.0.1', label: Option.none() })

const laptopStateWith = (version: number, agents: readonly AgentRow[], connection = 1) =>
  machineStateWith(LAPTOP, version, agents, {
    workspaces: [crookWorkspace],
    herdr: herdrLinkOf(connection),
  })

const working = (version: number) =>
  laptopStateWith(version, [agentRow({ status: 'working', stateChangeSeq: 6 })])

const blockedAt = (version: number, stateChangeSeq = ASKED_SEQ, ask = SCREEN_ASK) =>
  laptopStateWith(version, [
    agentRow({ status: 'blocked', stateChangeSeq, ask: Option.some(bashAsk(ask)) }),
  ])

const promptingHark =
  (prompt: HarkPrompt): HarkScript =>
  (call) => {
    if (isAskCreation(call)) {
      return interactionCreated(INTERACTION_ID)
    }

    if (isWait(call)) {
      return Option.match(prompt.respondedAt, {
        onNone: () => interactionWaited(prompt.said),
        onSome: (respondedAt) => interactionRespondedTo(prompt.said, respondedAt),
      })
    }

    return isCancel(call) ? interactionWaited('canceled') : acceptingHark(call)
  }

const unanswered = (): HarkPrompt => ({ said: 'pending', respondedAt: Option.none() })

const boot = Effect.fn('boot')(function* (prompt: HarkPrompt) {
  const hark = yield* fakeHark(promptingHark(prompt))
  const database = yield* Layer.build(Database.layerAt(IN_MEMORY))
  const start = Effect.map(
    Layer.build(
      harkServicesUnder(HarkNotifier.layer, hark.layer, Option.some(HARK_TOKEN), database),
    ),
    (context) => ({
      herd: Context.get(context, Herd),
      router: Context.get(context, CommandRouter),
    }),
  )

  return { calls: hark.calls, start, sql: Context.get(database, SqlClient.SqlClient) }
})

const auditRows = (sql: SqlClient.SqlClient) =>
  sql`SELECT * FROM audit ORDER BY id`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(HubAuditRecord))),
    Effect.map(
      Arr.map((record) => ({
        outcome: record.outcome,
        failure: Option.getOrNull(record.failure),
      })),
    ),
  )

const letFibersRun = TestClock.withLive(Effect.sleep(TIME_FOR_FIBERS))

const auditRowsOnce = Effect.fn('auditRowsOnce')(function* (sql: SqlClient.SqlClient) {
  yield* letFibersRun

  return yield* auditRows(sql)
})

const rowsReaching = (sql: SqlClient.SqlClient, count: number) =>
  auditRowsOnce(sql).pipe(Effect.repeat({ until: (rows) => rows.length >= count }))

const dialLink = Effect.fn('dialLink')(function* (
  herd: Herd['Service'],
  router: CommandRouter['Service'],
) {
  const inbox = yield* Queue.unbounded<RoutedCommand>()
  const link = yield* router.linkFor(LAPTOP)
  const attach = Stream.merge(Stream.fromEffectDrain(herd.hold(LAPTOP, hello)), link.attach).pipe(
    Stream.runForEach((routed) => Queue.offer(inbox, routed)),
    Effect.forkScoped({ startImmediately: true }),
  )
  const publish = (state: MachineState) => link.publish(state, herd.publish(LAPTOP, state))

  return { inbox, attach, publish }
})

const openLink = Effect.fn('openLink')(function* (
  herd: Herd['Service'],
  router: CommandRouter['Service'],
) {
  const { inbox, attach, publish } = yield* dialLink(herd, router)
  const attachment = yield* attach

  return { inbox, publish, close: Fiber.interrupt(attachment) }
})

const answerWhileAway = Effect.fn('answerWhileAway')(function* (
  prompt: HarkPrompt,
  calls: Queue.Dequeue<HarkCall>,
  herd: Herd['Service'],
  router: CommandRouter['Service'],
) {
  const link = yield* openLink(herd, router)

  yield* link.publish(working(1))
  yield* link.publish(blockedAt(2))
  yield* nextCallWhere(calls, isWait)
  yield* link.close
  prompt.said = 'approved'
  yield* nextCallWhere(calls, isWait)
  yield* letFibersRun
})

const completeDelivered = (router: CommandRouter['Service'], routed: RoutedCommand) =>
  router.complete(
    LAPTOP,
    routed.id,
    Result.succeed(
      new InputDelivered({ pane: PANE, terminal: TerminalId.make('term_1'), stateChangeSeq: 7 }),
    ),
  )

it.effect(
  'holds an answer given while the machine is away, then delivers it once and audits once',
  () =>
    Effect.gen(function* () {
      const prompt = unanswered()
      const { calls, sql, start } = yield* boot(prompt)
      const { herd, router } = yield* start

      yield* answerWhileAway(prompt, calls, herd, router)
      yield* TestClock.adjust(Duration.hours(A_DAY_LESS_AN_HOUR))
      const rowsWhileAway = yield* auditRowsOnce(sql)
      const callsWhileAway = yield* Queue.clear(calls)
      const back = yield* openLink(herd, router)

      yield* back.publish(blockedAt(3))
      const routed = yield* Queue.take(back.inbox)

      yield* completeDelivered(router, routed)
      const rowsAfter = yield* rowsReaching(sql, 1)

      yield* TestClock.adjust(Duration.hours(1))
      yield* back.close
      const again = yield* openLink(herd, router)

      yield* again.publish(blockedAt(4))

      expect(rowsWhileAway).toEqual([])
      expect(Arr.filter(callsWhileAway, isWait).length).toBe(0)
      expect(routed.key).toBe(INTERACTION_ID)
      expect(rowsAfter).toEqual([{ outcome: 'succeeded', failure: null }])
      expect(yield* auditRowsOnce(sql)).toEqual(rowsAfter)
      expect(yield* Queue.clear(again.inbox)).toEqual([])
      expect(yield* Queue.clear(back.inbox)).toEqual([])
    }).pipe(Effect.scoped),
)

it.effect('waits for both the link and a state published on it, in either order', () =>
  Effect.gen(function* () {
    const prompt = unanswered()
    const { calls, start } = yield* boot(prompt)
    const { herd, router } = yield* start

    yield* answerWhileAway(prompt, calls, herd, router)
    const linkFirst = yield* openLink(herd, router)

    yield* TestClock.adjust(Duration.minutes(1))
    yield* letFibersRun
    const beforePublish = yield* Queue.clear(linkFirst.inbox)

    yield* linkFirst.close
    const stateFirst = yield* dialLink(herd, router)

    yield* stateFirst.publish(blockedAt(3))
    yield* TestClock.adjust(Duration.minutes(1))
    yield* letFibersRun
    yield* stateFirst.attach
    const routed = yield* Queue.take(stateFirst.inbox)

    expect(beforePublish).toEqual([])
    expect(routed.key).toBe(INTERACTION_ID)
  }).pipe(Effect.scoped),
)

it.effect(
  'takes no state from a link a newer one has replaced, even while it still reads live',
  () =>
    Effect.gen(function* () {
      const prompt = unanswered()
      const { calls, start } = yield* boot(prompt)
      const { herd, router } = yield* start
      const silent = yield* openLink(herd, router)

      yield* silent.publish(working(1))
      yield* silent.publish(blockedAt(2))
      yield* nextCallWhere(calls, isWait)
      const redialed = yield* openLink(herd, router)

      prompt.said = 'approved'
      yield* nextCallWhere(calls, isWait)
      yield* letFibersRun
      const beforeItsState = yield* Queue.clear(redialed.inbox)

      yield* redialed.publish(blockedAt(3))
      const routed = yield* Queue.take(redialed.inbox)

      expect(beforeItsState).toEqual([])
      expect(routed.key).toBe(INTERACTION_ID)
      expect(yield* Queue.clear(silent.inbox)).toEqual([])
    }).pipe(Effect.scoped),
)

it.effect('delivers when the old link ends between the new link publishing and attaching', () =>
  Effect.gen(function* () {
    const prompt = unanswered()
    const { calls, start } = yield* boot(prompt)
    const { herd, router } = yield* start
    const silent = yield* openLink(herd, router)

    yield* silent.publish(working(1))
    yield* silent.publish(blockedAt(2))
    yield* nextCallWhere(calls, isWait)
    const redialed = yield* dialLink(herd, router)

    yield* redialed.publish(blockedAt(3))
    yield* silent.close
    prompt.said = 'approved'
    yield* nextCallWhere(calls, isWait)
    yield* letFibersRun
    yield* redialed.attach
    const routed = yield* Queue.take(redialed.inbox)

    expect(routed.key).toBe(INTERACTION_ID)
  }).pipe(Effect.scoped),
)

it.effect('sends nothing through a burst of attaches beyond the one send out', () =>
  Effect.gen(function* () {
    const prompt = unanswered()
    const { calls, sql, start } = yield* boot(prompt)
    const { herd, router } = yield* start

    yield* answerWhileAway(prompt, calls, herd, router)
    const first = yield* openLink(herd, router)

    yield* first.publish(blockedAt(3))
    const routed = yield* Queue.take(first.inbox)
    const others = yield* Effect.forEach(Arr.range(4, 8), (version) =>
      Effect.gen(function* () {
        const link = yield* openLink(herd, router)

        yield* link.publish(blockedAt(version))
        yield* letFibersRun

        return link.inbox
      }),
    )

    yield* completeDelivered(router, routed)
    const rows = yield* rowsReaching(sql, 1)
    const sentToOthers = yield* Effect.forEach(others, Queue.clear)

    expect(Arr.flatten(sentToOthers)).toEqual([])
    expect(rows).toEqual([{ outcome: 'succeeded', failure: null }])
  }).pipe(Effect.scoped),
)

it.effect(
  'sends again only on a newer state after a send the machine never answered, under the same key and one audit row',
  () =>
    Effect.gen(function* () {
      const prompt = unanswered()
      const { calls, sql, start } = yield* boot(prompt)
      const { herd, router } = yield* start

      yield* answerWhileAway(prompt, calls, herd, router)
      const link = yield* openLink(herd, router)

      yield* link.publish(blockedAt(3))
      const first = yield* Queue.take(link.inbox)

      yield* TestClock.adjust(Duration.minutes(1))
      yield* letFibersRun
      const withNoNewState = yield* Queue.clear(link.inbox)
      const rowsMeanwhile = yield* auditRows(sql)

      yield* link.publish(blockedAt(4))
      const second = yield* Queue.take(link.inbox)

      yield* completeDelivered(router, second)
      const rows = yield* rowsReaching(sql, 1)

      expect(withNoNewState).toEqual([])
      expect(rowsMeanwhile).toEqual([])
      expect(second.key).toBe(first.key)
      expect(second.command).toEqual(first.command)
      expect(rows).toEqual([{ outcome: 'succeeded', failure: null }])
    }).pipe(Effect.scoped),
)

it.effect(
  'never answers a new dialog that reads the same as the one answered, and raises it on its own',
  () =>
    Effect.gen(function* () {
      const prompt = unanswered()
      const { calls, sql, start } = yield* boot(prompt)
      const { herd, router } = yield* start

      yield* answerWhileAway(prompt, calls, herd, router)
      const back = yield* openLink(herd, router)

      yield* TestClock.adjust(Duration.seconds(16))
      yield* letFibersRun
      const beforeState = yield* Queue.clear(back.inbox)

      yield* Queue.clear(calls)
      yield* back.publish(blockedAt(3, NEXT_ASK_SEQ))
      const rows = yield* rowsReaching(sql, 1)
      const cancelled = yield* nextCallWhere(calls, isCancel)
      const raisedAgain = yield* nextCallWhere(calls, isAskCreation)

      yield* TestClock.adjust(Duration.minutes(1))
      yield* letFibersRun

      expect(beforeState).toEqual([])
      expect(yield* Queue.clear(back.inbox)).toEqual([])
      expect(rows).toEqual([{ outcome: 'failed', failure: 'AskNotPending' }])
      expect(cancelled.url).toContain(INTERACTION_ID)
      expect(raisedAgain.idempotencyKey).toEqual(
        Option.some(`crook/laptop/w1:p1/term_1/${NEXT_ASK_SEQ}/approvals/${SCREEN_ASK}`),
      )
    }).pipe(Effect.scoped),
)

it.effect('drops a held answer once its pane is gone or the agent asks something else', () =>
  Effect.gen(function* () {
    const outcomeAfter = Effect.fn('outcomeAfter')(function* (
      returned: (version: number) => ReturnType<typeof blockedAt>,
    ) {
      const prompt = unanswered()
      const { calls, sql, start } = yield* boot(prompt)
      const { herd, router } = yield* start

      yield* answerWhileAway(prompt, calls, herd, router)
      const back = yield* openLink(herd, router)

      yield* back.publish(returned(3))
      const rows = yield* rowsReaching(sql, 1)

      return [rows, yield* Queue.clear(back.inbox)]
    })
    const dropped = [[{ outcome: 'failed', failure: 'AskNotPending' }], []]

    expect(
      yield* outcomeAfter((version) =>
        laptopStateWith(version, [
          agentRow({ pane: OTHER_PANE, status: 'working', stateChangeSeq: 6 }),
        ]),
      ),
    ).toEqual(dropped)
    expect(yield* outcomeAfter((version) => blockedAt(version, ASKED_SEQ, 'toolu_next'))).toEqual(
      dropped,
    )
    expect(yield* outcomeAfter(working)).toEqual(dropped)
  }).pipe(Effect.scoped),
)

it.effect('keeps holding through a state that cannot tell, such as herdr being lost', () =>
  Effect.gen(function* () {
    const prompt = unanswered()
    const { calls, sql, start } = yield* boot(prompt)
    const { herd, router } = yield* start

    yield* answerWhileAway(prompt, calls, herd, router)
    const back = yield* openLink(herd, router)

    yield* back.publish(
      machineStateWith(LAPTOP, 3, [], {
        workspaces: [crookWorkspace],
        herdr: herdrLinkOf(1, Option.some(DateTime.makeUnsafe(0))),
      }),
    )
    yield* letFibersRun
    const whileLost = yield* Queue.clear(back.inbox)
    const rowsWhileLost = yield* auditRows(sql)

    yield* back.publish(blockedAt(4))
    const routed = yield* Queue.take(back.inbox)

    expect(whileLost).toEqual([])
    expect(rowsWhileLost).toEqual([])
    expect(routed.key).toBe(INTERACTION_ID)
  }).pipe(Effect.scoped),
)

it.effect('stops holding a day after the answer, and a machine back later gets nothing', () =>
  Effect.gen(function* () {
    const prompt: HarkPrompt = {
      said: 'pending',
      respondedAt: Option.some(ANSWERED_AT_THE_START),
    }
    const { calls, sql, start } = yield* boot(prompt)
    const { herd, router } = yield* start

    yield* answerWhileAway(prompt, calls, herd, router)
    yield* TestClock.adjust(Duration.hours(A_DAY_LESS_AN_HOUR))
    const beforeTheEnd = yield* auditRowsOnce(sql)

    yield* TestClock.adjust(Duration.hours(1))
    const rows = yield* rowsReaching(sql, 1)
    const back = yield* openLink(herd, router)

    yield* back.publish(blockedAt(3))
    yield* TestClock.adjust(Duration.hours(1))
    yield* letFibersRun

    expect(beforeTheEnd).toEqual([])
    expect(rows).toEqual([{ outcome: 'failed', failure: 'AnswerAgedOut' }])
    expect(yield* auditRows(sql)).toEqual(rows)
    expect(yield* Queue.clear(back.inbox)).toEqual([])
  }).pipe(Effect.scoped),
)

it.effect('ends a held answer when its machine is forgotten, with one audit row', () =>
  Effect.gen(function* () {
    const prompt = unanswered()
    const { calls, sql, start } = yield* boot(prompt)
    const { herd, router } = yield* start

    yield* answerWhileAway(prompt, calls, herd, router)
    yield* TestClock.adjust(Duration.seconds(16))
    yield* letFibersRun
    yield* Queue.clear(calls)
    yield* herd.forget(LAPTOP)
    const rows = yield* rowsReaching(sql, 1)
    const cancelled = yield* nextCallWhere(calls, isCancel)

    expect(rows).toEqual([{ outcome: 'failed', failure: 'AskNotPending' }])
    expect(cancelled.url).toContain(INTERACTION_ID)
  }).pipe(Effect.scoped),
)

it.effect(
  'lets a send out when the approval is withdrawn finish, and audits its real outcome',
  () =>
    Effect.gen(function* () {
      const prompt = unanswered()
      const { calls, sql, start } = yield* boot(prompt)
      const { herd, router } = yield* start

      yield* answerWhileAway(prompt, calls, herd, router)
      const back = yield* openLink(herd, router)

      yield* back.publish(blockedAt(3))
      const routed = yield* Queue.take(back.inbox)

      yield* back.publish(working(4))
      yield* nextCallWhere(calls, isCancel)
      const rowsBeforeReply = yield* auditRows(sql)

      yield* completeDelivered(router, routed)
      const rows = yield* rowsReaching(sql, 1)

      expect(rowsBeforeReply).toEqual([])
      expect(rows).toEqual([{ outcome: 'succeeded', failure: null }])
    }).pipe(Effect.scoped),
)

it.effect('refuses for good on what the agent says, and audits that once', () =>
  Effect.gen(function* () {
    const prompt = unanswered()
    const { calls, sql, start } = yield* boot(prompt)
    const { herd, router } = yield* start

    yield* answerWhileAway(prompt, calls, herd, router)
    const back = yield* openLink(herd, router)

    yield* back.publish(blockedAt(3))
    const routed = yield* Queue.take(back.inbox)

    yield* router.complete(
      LAPTOP,
      routed.id,
      Result.fail(new AskNotPending({ pane: PANE, ask: THE_ANSWER_ID })),
    )
    const rows = yield* rowsReaching(sql, 1)

    yield* back.publish(blockedAt(4))
    yield* letFibersRun

    expect(rows).toEqual([{ outcome: 'failed', failure: 'AskNotPending' }])
    expect(yield* Queue.clear(back.inbox)).toEqual([])
  }).pipe(Effect.scoped),
)

it.effect('keeps a held answer across a restart, and audits it once when it lands', () =>
  Effect.gen(function* () {
    const prompt = unanswered()
    const { calls, sql, start } = yield* boot(prompt)

    yield* Effect.scoped(
      Effect.gen(function* () {
        const { herd, router } = yield* start

        yield* answerWhileAway(prompt, calls, herd, router)
      }),
    )
    const rowsAcrossStop = yield* auditRows(sql)

    yield* Queue.clear(calls)
    const { herd, router } = yield* start

    yield* nextCallWhere(calls, isWait)
    const back = yield* openLink(herd, router)

    yield* TestClock.adjust(Duration.seconds(16))
    yield* letFibersRun
    const beforeState = yield* Queue.clear(back.inbox)

    yield* back.publish(blockedAt(3))
    const routed = yield* advancingClock(Queue.take(back.inbox))

    yield* completeDelivered(router, routed)
    const rows = yield* rowsReaching(sql, 1)

    expect(rowsAcrossStop).toEqual([])
    expect(beforeState).toEqual([])
    expect(rows).toEqual([{ outcome: 'succeeded', failure: null }])
  }).pipe(Effect.scoped),
)

it.effect('sends nothing and audits nothing again after a restart once an answer concluded', () =>
  Effect.gen(function* () {
    const prompt = unanswered()
    const { calls, sql, start } = yield* boot(prompt)

    yield* Effect.scoped(
      Effect.gen(function* () {
        const { herd, router } = yield* start

        yield* answerWhileAway(prompt, calls, herd, router)
        const back = yield* openLink(herd, router)

        yield* back.publish(blockedAt(3))
        const routed = yield* Queue.take(back.inbox)

        yield* completeDelivered(router, routed)
        yield* rowsReaching(sql, 1)
      }),
    )
    yield* Queue.clear(calls)
    const { herd, router } = yield* start

    yield* nextCallWhere(calls, isWait)
    const back = yield* openLink(herd, router)

    yield* back.publish(blockedAt(4))
    yield* TestClock.adjust(Duration.seconds(16))
    yield* letFibersRun

    expect(yield* Queue.clear(back.inbox)).toEqual([])
    expect(yield* auditRows(sql)).toEqual([{ outcome: 'succeeded', failure: null }])
  }).pipe(Effect.scoped),
)

it.effect('still delivers after a restart over the retry rows an older hub wrote', () =>
  Effect.gen(function* () {
    const prompt = unanswered()
    const { calls, sql, start } = yield* boot(prompt)

    yield* Effect.scoped(
      Effect.gen(function* () {
        const { herd, router } = yield* start

        yield* answerWhileAway(prompt, calls, herd, router)
      }),
    )
    yield* sql`
      INSERT INTO audit (at, actor, operation, machine, arguments, idempotency_key, outcome, failure)
      VALUES
        ('2026-01-01T00:00:00.000Z', 'hark', 'AnswerAsk', 'laptop', '{}', ${INTERACTION_ID}, 'failed', 'MachineOffline'),
        ('2026-01-01T00:00:15.000Z', 'hark', 'AnswerAsk', 'laptop', '{}', ${INTERACTION_ID}, 'failed', 'CommandTimedOut')
    `
    yield* Queue.clear(calls)
    const { herd, router } = yield* start

    yield* nextCallWhere(calls, isWait)
    const back = yield* openLink(herd, router)

    yield* back.publish(blockedAt(3))
    const routed = yield* advancingClock(Queue.take(back.inbox))

    expect(routed.key).toBe(INTERACTION_ID)
    expect(yield* auditRows(sql)).toEqual([
      { outcome: 'failed', failure: 'MachineOffline' },
      { outcome: 'failed', failure: 'CommandTimedOut' },
    ])
  }).pipe(Effect.scoped),
)

it.live(
  'delivers to an agent older than the hub over a real socket, with nothing new on the wire',
  () =>
    Effect.gen(function* () {
      const prompt = unanswered()
      const hark = yield* fakeHark(promptingHark(prompt))
      const hub = yield* Layer.build(hubOverHark(hark.layer, HARK_TOKEN))
      const dial = connect(AgentLink, AGENT_PATH, agentToken(LAPTOP)).pipe(Effect.provide(hub))

      yield* Effect.scoped(
        Effect.gen(function* () {
          const away = yield* dial

          yield* Effect.forkScoped(away.Attach({ hello: OLDER_HELLO }).pipe(Stream.runDrain))
          yield* away.PublishState({ state: working(1) })
          yield* away.PublishState({ state: blockedAt(2) })
          yield* Queue.take(hark.calls).pipe(Effect.repeat({ until: isWait }))
        }),
      )
      prompt.said = 'approved'

      yield* Queue.take(hark.calls).pipe(Effect.repeat({ until: isWait }))
      const back = yield* dial
      const inbox = yield* Queue.unbounded<RoutedCommand>()

      yield* Effect.forkScoped(
        back
          .Attach({ hello: OLDER_HELLO })
          .pipe(Stream.runForEach((routed) => Queue.offer(inbox, routed))),
      )
      yield* back.PublishState({ state: blockedAt(3) })
      const routed = yield* Queue.take(inbox)

      yield* back.CompleteCommand({
        id: routed.id,
        result: Result.succeed(
          new InputDelivered({
            pane: PANE,
            terminal: TerminalId.make('term_1'),
            stateChangeSeq: 7,
          }),
        ),
      })

      expect(routed.key).toBe(INTERACTION_ID)
    }).pipe(Effect.scoped),
  SOCKET_TEST_LIMIT_MILLIS,
)
