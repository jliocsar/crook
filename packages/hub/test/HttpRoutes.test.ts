import { expect, layer } from '@effect/vitest'
import * as Clock from 'effect/Clock'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as HttpClient from 'effect/http/HttpClient'
import * as RpcClient from 'effect/rpc/RpcClient'
import * as SqlClient from 'effect/sql/SqlClient'

import { REDACTED } from '@crook/domain/Audit'
import {
  AnswerAsk,
  Approve,
  ClosePane,
  Decline,
  InputDelivered,
  PaneRenamed,
  Prompt,
  RenameAgent,
  SendKeys,
} from '@crook/domain/Command'
import { AskId, IdempotencyKey, MachineId, PaneId, TerminalId } from '@crook/domain/Ids'
import {
  BrowserLoginRequired,
  ExeDevIdentity,
  HubOriginInvalid,
  MachineUnidentified,
  OwnerEmailRejected,
  UpgradeOriginRejected,
} from '@crook/hub/ExeDevIdentity'
import { HubAuditRecord } from '@crook/hub/AuditTrail'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type SentRequest,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import { AgentPromptMethod } from '@crook/herdr/Methods'
import * as HttpRoutes from '@crook/hub/HttpRoutes'
import { AGENT_PING_INTERVAL, AgentLink, MachineIdMismatch } from '@crook/protocol/AgentLink'
import { ClientApi, MachineStillConnected, PaneNotInHerd } from '@crook/protocol/ClientApi'
import { AGENT_PATH, CLIENT_PATH, HEALTH_PATH } from '@crook/protocol/HubRoutes'
import {
  AskNotPending,
  type CommandResult,
  FolderNotFound,
  MachineOffline,
  PaneNotAgent,
  PaneNotCreatedByCrook,
  type RoutedCommand,
} from '@crook/protocol/Commands'

import {
  HUB_ORIGIN,
  OWNER,
  PANE,
  agentRow,
  agentToken,
  configFor,
  connect,
  hello,
  herdWhere,
  machineIn,
  machineShows,
  machineStateWith,
  ownerLogin,
  realAgent,
  testHub,
  tokenContextOf,
} from './Fixtures'

const EVIL_ORIGIN = 'https://evil.example'
const STRANGER = 'someone@example.com'
const ASK = AskId.make('toolu_01XXC3bash')
const BUN_IDLE_TIMEOUT_TICK = Duration.seconds(4)

const stateOf = (machine: MachineId, version: number) =>
  machineStateWith(machine, version, [agentRow()])

const auditedOn = Effect.fn('auditedOn')(function* (machine: MachineId) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql`SELECT * FROM audit WHERE machine = ${machine} ORDER BY id`

  return yield* Schema.decodeUnknownEffect(Schema.Array(HubAuditRecord))(rows)
})

const attachAs = Effect.fn('attachAs')(function* (
  machine: MachineId,
  pingInterval: Duration.Duration = AGENT_PING_INTERVAL,
) {
  const agent = yield* connect(AgentLink, AGENT_PATH, agentToken(machine), pingInterval)

  yield* agent.Attach({ hello }).pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped)
  yield* agent.PublishState({ state: stateOf(machine, 1) })

  return agent
})

const get = (path: string, headers: Record<string, string> = {}) =>
  HttpClient.get(path, { headers }).pipe(
    Effect.flatMap((response) =>
      Effect.map(response.text, (body) => ({ status: response.status, body })),
    ),
  )

const rejectedWith = (rejection: { readonly message: string }) => ({
  status: 403,
  body: rejection.message,
})

const answeringAgent = Effect.fn('answeringAgent')(function* (
  machine: MachineId,
  answer: (routed: RoutedCommand) => CommandResult,
) {
  const agent = yield* connect(AgentLink, AGENT_PATH, agentToken(machine))

  yield* agent.Attach({ hello }).pipe(
    Stream.runForEach((routed) => agent.CompleteCommand({ id: routed.id, result: answer(routed) })),
    Effect.ignore,
    Effect.forkScoped,
  )
  yield* agent.PublishState({ state: stateOf(machine, 1) })
})

layer(testHub, { excludeTestServices: true })('HttpRoutes', (live) => {
  live.effect('answers the health check without any exe.dev headers', () =>
    Effect.gen(function* () {
      expect(yield* get(HEALTH_PATH)).toEqual({ status: 200, body: 'ok' })
    }),
  )

  live.effect('serves the PWA to the owner logged in through a browser, and nobody else', () =>
    Effect.gen(function* () {
      const page = yield* get('/', ownerLogin)
      const deepLink = yield* get('/herd', { ...ownerLogin, Accept: 'text/html' })

      expect(page.body).toContain('<title>crook</title>')
      expect(deepLink.status).toBe(200)
      expect(yield* get('/')).toEqual(
        rejectedWith(new OwnerEmailRejected({ email: Option.none() })),
      )
      expect(yield* get('/', { 'X-ExeDev-Email': STRANGER })).toEqual(
        rejectedWith(new OwnerEmailRejected({ email: Option.some(STRANGER) })),
      )
      expect(yield* get('/', agentToken('laptop'))).toEqual(
        rejectedWith(new BrowserLoginRequired()),
      )
    }),
  )

  live.effect('refuses phone sockets from another origin, another login or an agent token', () =>
    Effect.gen(function* () {
      expect(yield* get(CLIENT_PATH, { ...ownerLogin, Origin: EVIL_ORIGIN })).toEqual(
        rejectedWith(new UpgradeOriginRejected({ origin: Option.some(EVIL_ORIGIN) })),
      )
      expect(yield* get(CLIENT_PATH, { 'X-ExeDev-Email': OWNER })).toEqual(
        rejectedWith(new UpgradeOriginRejected({ origin: Option.none() })),
      )
      expect(yield* get(CLIENT_PATH, { Origin: HUB_ORIGIN })).toEqual(
        rejectedWith(new OwnerEmailRejected({ email: Option.none() })),
      )
      expect(yield* get(CLIENT_PATH, { ...agentToken('laptop'), Origin: HUB_ORIGIN })).toEqual(
        rejectedWith(new BrowserLoginRequired()),
      )
    }),
  )

  live.effect('refuses agent sockets without a machine id or minted by someone else', () =>
    Effect.gen(function* () {
      expect(yield* get(AGENT_PATH, { 'X-ExeDev-Email': OWNER })).toEqual(
        rejectedWith(new MachineUnidentified()),
      )
      expect(
        yield* get(AGENT_PATH, { 'X-ExeDev-Email': OWNER, 'X-ExeDev-Token-Ctx': '{}' }),
      ).toEqual(rejectedWith(new MachineUnidentified()))
      expect(
        yield* get(AGENT_PATH, { ...agentToken('laptop'), 'X-ExeDev-Email': STRANGER }),
      ).toEqual(rejectedWith(new OwnerEmailRejected({ email: Option.some(STRANGER) })))
    }),
  )

  live.effect(
    'shows an attached agent online with its state, then reconnecting when it drops',
    () =>
      Effect.gen(function* () {
        const laptop = MachineId.make('laptop')
        const online = yield* Effect.scoped(
          Effect.andThen(attachAs(laptop), machineShows(laptop, 'online')),
        )
        const dropped = yield* machineShows(laptop, 'reconnecting')

        expect(Option.flatMap(machineIn(online, laptop), (entry) => entry.state)).toEqual(
          Option.some(stateOf(laptop, 1)),
        )
        expect(Option.flatMap(machineIn(dropped, laptop), (entry) => entry.state)).toEqual(
          Option.some(stateOf(laptop, 1)),
        )
      }),
  )

  live.effect('marks a pane seen and refuses to forget a connected machine for the phone', () =>
    Effect.gen(function* () {
      const laptop = MachineId.make('seen-laptop')

      yield* attachAs(laptop)
      const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
      const refused = yield* phone.ForgetMachine({ machine: laptop }).pipe(Effect.flip)

      yield* phone.MarkSeen({ machine: laptop, pane: PANE })
      const seen = yield* herdWhere((view) =>
        Option.exists(machineIn(view, laptop), (entry) => entry.seen.includes(PANE)),
      )

      expect(refused).toEqual(new MachineStillConnected({ machine: laptop, connection: 'online' }))
      expect(Option.map(machineIn(seen, laptop), (entry) => entry.seen)).toEqual(
        Option.some([PANE]),
      )
    }),
  )

  live.effect('takes the machine from the upgrade, not from headers the agent sends per call', () =>
    Effect.gen(function* () {
      const laptop = MachineId.make('spoof-laptop')
      const impostor = MachineId.make('spoof-impostor')
      const agent = yield* connect(AgentLink, AGENT_PATH, agentToken(laptop))
      const mismatch = yield* agent
        .PublishState({ state: stateOf(impostor, 0) })
        .pipe(RpcClient.withHeaders(tokenContextOf(impostor)), Effect.flip)

      expect(mismatch).toEqual(
        new MachineIdMismatch({ connectedMachine: laptop, publishedMachine: impostor }),
      )
    }),
  )

  live.effect(
    'drops an agent that goes silent and keeps one that pings',
    () =>
      Effect.gen(function* () {
        const silent = MachineId.make('silent')
        const pinging = MachineId.make('pinging')

        yield* attachAs(silent, Duration.infinity)
        const silentSince = yield* Clock.currentTimeMillis
        yield* attachAs(pinging)
        yield* machineShows(silent, 'reconnecting')
        const silentFor = Duration.millis((yield* Clock.currentTimeMillis) - silentSince)

        expect(
          Duration.isGreaterThanOrEqualTo(
            silentFor,
            Duration.subtract(HttpRoutes.SOCKET_SILENCE_TIMEOUT, BUN_IDLE_TIMEOUT_TICK),
          ),
        ).toBe(true)
        expect(
          Option.map(
            machineIn(yield* herdWhere(() => true), pinging),
            (entry) => entry.machine.connection,
          ),
        ).toEqual(Option.some('online'))
      }),
    { timeout: Duration.toMillis(Duration.times(HttpRoutes.SOCKET_SILENCE_TIMEOUT, 2)) },
  )
})

layer(testHub, { excludeTestServices: true })('Commands through HttpRoutes', (live) => {
  const pane = PaneId.make('w1:p1')
  const key = IdempotencyKey.make('3f1c8a52-0b7e-4d0a-9a51-6f3f0d2f8e11')

  live.effect('relays a phone command to the agent of that machine and its answer back', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('command-laptop')

      yield* answeringAgent(machine, (routed) =>
        Match.value(routed.command).pipe(
          Match.tagsExhaustive({
            Prompt: (prompt) =>
              Result.succeed(
                new InputDelivered({
                  pane: prompt.pane,
                  terminal: TerminalId.make('term_1'),
                  stateChangeSeq: 4,
                }),
              ),
            SendKeys: (sendKeys) => Result.fail(new PaneNotAgent({ pane: sendKeys.pane })),
            RenameAgent: (rename) =>
              Result.succeed(new PaneRenamed({ pane: rename.pane, label: rename.label })),
            ClosePane: (close) => Result.fail(new PaneNotCreatedByCrook({ pane: close.pane })),
            AnswerAsk: (answer) =>
              Result.fail(new AskNotPending({ pane: answer.pane, ask: answer.ask })),
            StartAgent: (start) => Result.fail(new FolderNotFound({ folder: start.folder })),
            CreateWorktree: (create) => Result.fail(new FolderNotFound({ folder: create.folder })),
          }),
        ),
      )
      const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
      const receipt = yield* phone.SendCommand({
        machine,
        key,
        command: new Prompt({ pane, text: 'continue' }),
      })
      const refused = yield* phone
        .SendCommand({ machine, key, command: new SendKeys({ pane, keys: ['esc'] }) })
        .pipe(Effect.flip)
      const stale = yield* phone
        .SendCommand({
          machine,
          key,
          command: new AnswerAsk({ pane, ask: ASK, answer: new Approve({}) }),
        })
        .pipe(Effect.flip)

      expect(receipt).toEqual(
        new InputDelivered({ pane, terminal: TerminalId.make('term_1'), stateChangeSeq: 4 }),
      )
      expect(refused).toEqual(new PaneNotAgent({ pane }))
      expect(stale).toEqual(new AskNotPending({ pane, ask: ASK }))
    }),
  )

  live.effect(
    'carries a phone command through the real agent to herdr, and replays the same key',
    () =>
      Effect.gen(function* () {
        const machine = MachineId.make('command-agent')
        const state = yield* SubscriptionRef.make(
          machineStateWith(machine, 1, [
            agentRow({
              pane,
              status: 'idle',
              stateChangeSeq: 4,
              statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
            }),
          ]),
        )
        const sent = yield* Queue.unbounded<SentRequest>()
        const herdr = HerdrClient.layerTest({
          responses: [scriptedResult(AgentPromptMethod, { type: 'agent_prompted' })],
          events: yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>(),
          sent,
        })

        yield* Layer.build(yield* realAgent(machine, state, herdr, []))
        yield* machineShows(machine, 'online')
        const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
        const command = new Prompt({ pane, text: 'continue' })
        const receipt = yield* phone.SendCommand({ machine, key, command })
        const replayed = yield* phone.SendCommand({ machine, key, command })

        expect(receipt).toEqual(
          new InputDelivered({ pane, terminal: TerminalId.make('term_1'), stateChangeSeq: 4 }),
        )
        expect(replayed).toEqual(receipt)
        expect((yield* Queue.clear(sent)).map((request) => request.method)).toEqual([
          'agent.prompt',
        ])
      }),
  )

  live.effect(
    'audits each command with the login the upgrade carried, however the call is dressed',
    () =>
      Effect.gen(function* () {
        const machine = MachineId.make('audit-laptop')

        yield* answeringAgent(machine, (routed) =>
          Match.value(routed.command).pipe(
            Match.tagsExhaustive({
              Prompt: (prompt) =>
                Result.succeed(
                  new InputDelivered({
                    pane: prompt.pane,
                    terminal: TerminalId.make('term_1'),
                    stateChangeSeq: 4,
                  }),
                ),
              SendKeys: (sendKeys) => Result.fail(new PaneNotAgent({ pane: sendKeys.pane })),
              RenameAgent: (rename) =>
                Result.succeed(new PaneRenamed({ pane: rename.pane, label: rename.label })),
              ClosePane: (close) => Result.fail(new PaneNotCreatedByCrook({ pane: close.pane })),
              AnswerAsk: (answer) =>
                Result.succeed(
                  new InputDelivered({
                    pane: answer.pane,
                    terminal: TerminalId.make('term_1'),
                    stateChangeSeq: 4,
                  }),
                ),
              StartAgent: (start) => Result.fail(new FolderNotFound({ folder: start.folder })),
              CreateWorktree: (create) =>
                Result.fail(new FolderNotFound({ folder: create.folder })),
            }),
          ),
        )
        const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)

        yield* phone
          .SendCommand({ machine, key, command: new Prompt({ pane, text: 'ship it' }) })
          .pipe(RpcClient.withHeaders({ 'X-ExeDev-Email': STRANGER }))
        yield* phone.SendCommand({
          machine,
          key,
          command: new RenameAgent({ pane, label: Option.some('Payments') }),
        })
        const notOurs = yield* phone
          .SendCommand({ machine, key, command: new ClosePane({ pane, confirmed: false }) })
          .pipe(Effect.flip)
        yield* phone.SendCommand({
          machine,
          key,
          command: new AnswerAsk({
            pane,
            ask: ASK,
            answer: new Decline({ message: Option.some('use printf instead') }),
          }),
        })
        const audited = yield* auditedOn(machine)

        expect(notOurs).toEqual(new PaneNotCreatedByCrook({ pane }))
        expect(
          audited.map((entry) => [
            entry.actor,
            entry.operation,
            entry.arguments,
            entry.idempotencyKey,
            entry.outcome,
            entry.failure,
          ]),
        ).toEqual([
          [OWNER, 'Prompt', { pane, text: REDACTED }, Option.some(key), 'succeeded', Option.none()],
          [
            OWNER,
            'RenameAgent',
            { pane, label: 'Payments' },
            Option.some(key),
            'succeeded',
            Option.none(),
          ],
          [
            OWNER,
            'ClosePane',
            { pane, confirmed: false },
            Option.some(key),
            'failed',
            Option.some('PaneNotCreatedByCrook'),
          ],
          [
            OWNER,
            'AnswerAsk',
            { pane, ask: ASK, answer: 'Decline', text: REDACTED },
            Option.some(key),
            'succeeded',
            Option.none(),
          ],
        ])
      }),
  )

  live.effect('pins an agent for the phone and audits pins and forgets, never mark seen', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('pin-laptop')

      yield* attachAs(machine)
      const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)

      yield* phone.SetPinned({ machine, pane, pinned: true })
      const pinned = yield* herdWhere((view) =>
        Option.exists(machineIn(view, machine), (entry) => entry.pinned.includes(pane)),
      )
      const unknownPane = PaneId.make('w1:p9')
      const refused = yield* phone
        .SetPinned({ machine, pane: unknownPane, pinned: true })
        .pipe(Effect.flip)

      yield* phone.MarkSeen({ machine, pane })
      yield* phone.ForgetMachine({ machine }).pipe(Effect.flip)
      const audited = yield* auditedOn(machine)

      expect(Option.map(machineIn(pinned, machine), (entry) => entry.pinned)).toEqual(
        Option.some([pane]),
      )
      expect(refused).toEqual(new PaneNotInHerd({ machine, pane: unknownPane }))
      expect(
        audited.map((entry) => [entry.operation, entry.arguments, entry.outcome, entry.failure]),
      ).toEqual([
        ['SetPinned', { pane, pinned: true }, 'succeeded', Option.none()],
        ['SetPinned', { pane: unknownPane, pinned: true }, 'failed', Option.some('PaneNotInHerd')],
        ['ForgetMachine', {}, 'failed', Option.some('MachineStillConnected')],
      ])
    }),
  )

  live.effect('answers MachineOffline for a machine whose agent is not attached', () =>
    Effect.gen(function* () {
      const machine = MachineId.make('command-nowhere')
      const phone = yield* connect(ClientApi, CLIENT_PATH, ownerLogin)
      const offline = yield* phone
        .SendCommand({ machine, key, command: new Prompt({ pane, text: 'continue' }) })
        .pipe(Effect.flip)

      expect(offline).toEqual(new MachineOffline({ machine }))
    }),
  )
})

layer(Layer.empty)('ExeDevIdentity', (it) => {
  it.effect('refuses to start with a CROOK_HUB_ORIGIN that is not an https address', () =>
    Effect.gen(function* () {
      const failure = yield* Layer.build(
        Layer.provide(ExeDevIdentity.layer, configFor('my-hub.exe.xyz:8000')),
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(HubOriginInvalid)
    }),
  )
})
