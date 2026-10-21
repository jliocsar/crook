import { expect, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as TestClock from 'effect/testing/TestClock'

import { CommandExecutor, HERDR_DELIVERY_TIMEOUT } from '@crook/agent/CommandExecutor'
import { HUB_RECONNECT_BASE } from '@crook/agent/HubLink'
import { type AgentAuditEntry, AuditLog } from '@crook/agent/AuditLog'
import { AuditPolicy, REDACTED } from '@crook/domain/Audit'
import {
  ClosePane,
  InputDelivered,
  PaneClosed,
  PaneRenamed,
  Prompt,
  RenameAgent,
  SendKeys,
  interrupt,
} from '@crook/domain/Command'
import { IdempotencyKey, PaneId } from '@crook/domain/Ids'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type ScriptedResponse,
  type SentRequest,
  scriptedRejection,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import {
  AgentPromptMethod,
  AgentSendKeysMethod,
  PaneCloseMethod,
  PaneRenameMethod,
} from '@crook/herdr/Methods'
import { COMMAND_TIMEOUT } from '@crook/protocol/AgentLink'
import {
  CommandDeliveryUnknown,
  HerdrRefusedCommand,
  HerdrUnavailable,
  PaneNotAgent,
  PaneNotCreatedByCrook,
} from '@crook/protocol/Commands'

import {
  AUDIT_EVERYTHING,
  type ExecutorOptions,
  LAPTOP,
  TERMINAL,
  agentRow,
  executorWith,
  machineStateWith,
  paneInfo,
} from './Fixtures'

const AGENT_PANE = PaneId.make('w1:p1')
const SHELL_PANE = PaneId.make('w1:p2')
const FIRST_ACTION = IdempotencyKey.make('3f1c8a52-0b7e-4d0a-9a51-6f3f0d2f8e11')
const SECOND_ACTION = IdempotencyKey.make('9b2e4d17-5c6a-4f81-8e0d-2a7c1b9f4e63')

const prompted = scriptedResult(AgentPromptMethod, { type: 'agent_prompted' })
const keysSent = scriptedResult(AgentSendKeysMethod, { type: 'ok' })
const continuePrompt = new Prompt({ pane: AGENT_PANE, text: 'continue' })
const delivered = new InputDelivered({ pane: AGENT_PANE, terminal: TERMINAL, stateChangeSeq: 4 })

const SentLine = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, method: Schema.String, params: Schema.Unknown }),
)

const sentRequests = (requests: readonly SentRequest[]) =>
  requests.map((request) => Schema.decodeSync(SentLine)(request.line))

const startExecutor = Effect.fn('startExecutor')(function* (
  responses: readonly ScriptedResponse[],
  options: ExecutorOptions = {},
) {
  const state = yield* SubscriptionRef.make(machineStateWith([agentRow()]))
  const sent = yield* Queue.unbounded<SentRequest>()
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const context = yield* Layer.build(
    executorWith(HerdrClient.layerTest({ responses, events, sent }), state, options),
  )

  return { executor: Context.get(context, CommandExecutor), sent: Queue.clear(sent), state }
})

const startStuckExecutor = Effect.fn('startStuckExecutor')(function* () {
  const state = yield* SubscriptionRef.make(machineStateWith([agentRow()]))
  const requests = yield* Queue.unbounded<string>()
  const stuckHerdr = Layer.mock(HerdrClient, {
    request: (method) => Queue.offer(requests, method.name).pipe(Effect.andThen(Effect.never)),
  })
  const context = yield* Layer.build(executorWith(stuckHerdr, state))

  return { executor: Context.get(context, CommandExecutor), requests }
})

it.effect('sends a prompt to the agent pane through agent.prompt', () =>
  Effect.gen(function* () {
    const { executor, sent } = yield* startExecutor([prompted])
    const receipt = yield* executor.execute(FIRST_ACTION, continuePrompt)

    expect(receipt).toEqual(delivered)
    expect(sentRequests(yield* sent)).toEqual([
      { id: 'agent.prompt', method: 'agent.prompt', params: { target: 'w1:p1', text: 'continue' } },
    ])
  }),
)

it.effect('interrupts an agent by sending esc through agent.send_keys', () =>
  Effect.gen(function* () {
    const { executor, sent } = yield* startExecutor([keysSent])

    yield* executor.execute(FIRST_ACTION, interrupt(AGENT_PANE))

    expect(sentRequests(yield* sent)).toEqual([
      {
        id: 'agent.send_keys',
        method: 'agent.send_keys',
        params: { target: 'w1:p1', keys: ['esc'] },
      },
    ])
  }),
)

it.effect('replays the first outcome for a key it has already run, without sending again', () =>
  Effect.gen(function* () {
    const { executor, sent, state } = yield* startExecutor([prompted])
    const first = yield* executor.execute(FIRST_ACTION, continuePrompt)

    yield* SubscriptionRef.set(state, machineStateWith([agentRow({ stateChangeSeq: 5 })]))
    const replayed = yield* executor.execute(FIRST_ACTION, continuePrompt)
    const fresh = yield* executor.execute(SECOND_ACTION, continuePrompt)

    expect(replayed).toEqual(first)
    expect(fresh).toEqual(
      new InputDelivered({ pane: AGENT_PANE, terminal: TERMINAL, stateChangeSeq: 5 }),
    )
    expect(yield* sent).toHaveLength(2)
  }),
)

it.effect('runs a key once when a retry arrives while the first delivery is still running', () =>
  Effect.gen(function* () {
    const { executor, sent } = yield* startExecutor([prompted])
    const both = yield* Effect.all(
      [
        executor.execute(FIRST_ACTION, continuePrompt),
        executor.execute(FIRST_ACTION, continuePrompt),
      ],
      { concurrency: 'unbounded' },
    )

    expect(both).toEqual([delivered, delivered])
    expect(yield* sent).toHaveLength(1)
  }),
)

it.effect('refuses input to a pane that hosts no agent, and sends nothing', () =>
  Effect.gen(function* () {
    const { executor, sent } = yield* startExecutor([keysSent])
    const refused = yield* executor
      .execute(FIRST_ACTION, new SendKeys({ pane: SHELL_PANE, keys: ['ctrl+c'] }))
      .pipe(Effect.flip)

    expect(refused).toEqual(new PaneNotAgent({ pane: SHELL_PANE }))
    expect(yield* sent).toEqual([])
  }),
)

it.effect('forgets a refusal, so the same key runs once the pane hosts an agent', () =>
  Effect.gen(function* () {
    const { executor, sent, state } = yield* startExecutor([prompted])
    const shellPrompt = new Prompt({ pane: SHELL_PANE, text: 'continue' })

    yield* executor.execute(FIRST_ACTION, shellPrompt).pipe(Effect.flip)
    yield* SubscriptionRef.set(
      state,
      machineStateWith([agentRow(), agentRow({ pane: SHELL_PANE, stateChangeSeq: 1 })]),
    )
    const receipt = yield* executor.execute(FIRST_ACTION, shellPrompt)

    expect(receipt).toEqual(
      new InputDelivered({ pane: SHELL_PANE, terminal: TERMINAL, stateChangeSeq: 1 }),
    )
    expect(yield* sent).toHaveLength(1)
  }),
)

it.effect('passes a herdr refusal through and sends again on retry', () =>
  Effect.gen(function* () {
    const blocked = scriptedRejection(
      AgentPromptMethod,
      'agent_blocked',
      'agent w1:p1 is waiting at an approval dialog',
    )
    const { executor, sent } = yield* startExecutor([blocked])
    const first = yield* executor.execute(FIRST_ACTION, continuePrompt).pipe(Effect.flip)
    const retried = yield* executor.execute(FIRST_ACTION, continuePrompt).pipe(Effect.flip)

    expect(first).toEqual(
      new HerdrRefusedCommand({
        code: 'agent_blocked',
        detail: 'agent w1:p1 is waiting at an approval dialog',
      }),
    )
    expect(retried).toEqual(first)
    expect(yield* sent).toHaveLength(2)
  }),
)

it.effect('remembers an unconfirmed delivery, so a retry never sends it twice', () =>
  Effect.gen(function* () {
    const { executor, sent } = yield* startExecutor([])
    const first = yield* executor.execute(FIRST_ACTION, continuePrompt).pipe(Effect.flip)
    const retried = yield* executor.execute(FIRST_ACTION, continuePrompt).pipe(Effect.flip)

    expect(first).toEqual(new CommandDeliveryUnknown())
    expect(retried).toEqual(first)
    expect(yield* sent).toHaveLength(1)
  }),
)

it.effect('reports herdr unavailable when its socket does not answer', () =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make(machineStateWith([agentRow()]))
    const context = yield* Layer.build(
      executorWith(HerdrClient.layerAt(`${import.meta.dirname}/missing-herdr.sock`), state),
    )
    const failure = yield* Context.get(context, CommandExecutor)
      .execute(FIRST_ACTION, continuePrompt)
      .pipe(Effect.flip)

    expect(failure).toEqual(new HerdrUnavailable())
  }),
)

it.effect('finishes a delivery that has started even when its caller is interrupted', () =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make(machineStateWith([agentRow()]))
    const sent = yield* Queue.unbounded<SentRequest>()
    const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
    const requests = yield* Queue.unbounded<string>()
    const answer = yield* Deferred.make<void>()
    const scripted = Context.get(
      yield* Layer.build(HerdrClient.layerTest({ responses: [prompted], events, sent })),
      HerdrClient,
    )
    const slowHerdr = Layer.mock(HerdrClient, {
      request: (method, params) =>
        Queue.offer(requests, method.name).pipe(
          Effect.andThen(Deferred.await(answer)),
          Effect.andThen(scripted.request(method, params)),
        ),
    })
    const executor = Context.get(
      yield* Layer.build(executorWith(slowHerdr, state)),
      CommandExecutor,
    )
    const caller = yield* Effect.forkChild(executor.execute(FIRST_ACTION, continuePrompt))

    yield* Queue.take(requests)
    const interrupted = yield* Effect.forkChild(Fiber.interrupt(caller))
    yield* Effect.yieldNow
    yield* Deferred.succeed(answer, undefined)
    yield* Fiber.join(interrupted)
    const retried = yield* executor.execute(FIRST_ACTION, continuePrompt)

    expect(retried).toEqual(delivered)
    expect(yield* Queue.size(requests)).toBe(0)
    expect(yield* Queue.clear(sent)).toHaveLength(1)
  }),
)

it.effect(
  'answers PaneNotAgent when herdr finds no agent in the pane, and sends again on retry',
  () =>
    Effect.gen(function* () {
      const exited = scriptedRejection(
        AgentPromptMethod,
        'agent_not_found',
        'no agent in pane w1:p1',
      )
      const { executor, sent } = yield* startExecutor([exited])
      const first = yield* executor.execute(FIRST_ACTION, continuePrompt).pipe(Effect.flip)
      const retried = yield* executor.execute(FIRST_ACTION, continuePrompt).pipe(Effect.flip)

      expect(first).toEqual(new PaneNotAgent({ pane: AGENT_PANE }))
      expect(retried).toEqual(first)
      expect(yield* sent).toHaveLength(2)
    }),
)

it.effect('gives up on a herdr that never answers, and remembers the delivery as unknown', () =>
  Effect.gen(function* () {
    const { executor, requests } = yield* startStuckExecutor()
    const caller = yield* Effect.forkChild(executor.execute(FIRST_ACTION, continuePrompt))

    yield* Queue.take(requests)
    yield* TestClock.adjust(HERDR_DELIVERY_TIMEOUT)
    const failure = yield* Fiber.join(caller).pipe(Effect.flip)
    const retried = yield* executor.execute(FIRST_ACTION, continuePrompt).pipe(Effect.flip)

    expect(failure).toEqual(new CommandDeliveryUnknown())
    expect(retried).toEqual(failure)
    expect(yield* Queue.size(requests)).toBe(0)
  }),
)

it.effect('lets an interrupted caller go once a stuck delivery has run out of time', () =>
  Effect.gen(function* () {
    const { executor, requests } = yield* startStuckExecutor()
    const caller = yield* Effect.forkChild(executor.execute(FIRST_ACTION, continuePrompt))

    yield* Queue.take(requests)
    const interrupting = yield* Effect.forkChild(Fiber.interrupt(caller))
    yield* TestClock.adjust(HERDR_DELIVERY_TIMEOUT)
    yield* Fiber.join(interrupting)

    expect(Exit.hasInterrupts(yield* Fiber.await(caller))).toBe(true)
  }),
)

it('gives up on herdr early enough for its answer to reach the hub before the hub stops waiting', () => {
  expect(
    Duration.isLessThan(Duration.sum(HERDR_DELIVERY_TIMEOUT, HUB_RECONNECT_BASE), COMMAND_TIMEOUT),
  ).toBe(true)
})

const renamedTo = (label: Option.Option<string>) =>
  scriptedResult(PaneRenameMethod, { type: 'pane_info', pane: paneInfo({ label }) })
const renamed = renamedTo(Option.some('Payments'))
const closed = scriptedResult(PaneCloseMethod, { type: 'ok' })
const rename = new RenameAgent({ pane: AGENT_PANE, label: Option.some('Payments') })
const unconfirmedClose = new ClosePane({ pane: AGENT_PANE, confirmed: false })
const confirmedClose = new ClosePane({ pane: AGENT_PANE, confirmed: true })

it.effect('renames the pane in herdr and asks for a re-read, since herdr sends no event', () =>
  Effect.gen(function* () {
    const rereads = yield* Ref.make(0)
    const { executor, sent } = yield* startExecutor([renamed], {
      invalidate: Ref.update(rereads, (count) => count + 1),
    })
    const receipt = yield* executor.execute(FIRST_ACTION, rename)

    yield* executor.execute(FIRST_ACTION, rename)
    yield* executor.execute(
      SECOND_ACTION,
      new RenameAgent({ pane: AGENT_PANE, label: Option.none() }),
    )

    expect(receipt).toEqual(new PaneRenamed({ pane: AGENT_PANE, label: Option.some('Payments') }))
    expect(sentRequests(yield* sent).map((request) => request.params)).toEqual([
      { pane_id: 'w1:p1', label: 'Payments' },
      { pane_id: 'w1:p1', label: null },
    ])
    expect(yield* Ref.get(rereads)).toBe(2)
  }),
)

it.effect('answers a rename with the name herdr says it stored', () =>
  Effect.gen(function* () {
    const { executor } = yield* startExecutor([renamedTo(Option.none())])
    const cleared = yield* executor.execute(
      FIRST_ACTION,
      new RenameAgent({ pane: AGENT_PANE, label: Option.none() }),
    )

    expect(cleared).toEqual(new PaneRenamed({ pane: AGENT_PANE, label: Option.none() }))
  }),
)

it.effect('closes a pane crook created without asking, and forgets it once closed', () =>
  Effect.gen(function* () {
    const { executor, sent } = yield* startExecutor([closed], { created: [AGENT_PANE] })
    const receipt = yield* executor.execute(FIRST_ACTION, unconfirmedClose)
    const refused = yield* executor.execute(SECOND_ACTION, unconfirmedClose).pipe(Effect.flip)

    expect(receipt).toEqual(new PaneClosed({ pane: AGENT_PANE }))
    expect(refused).toEqual(new PaneNotCreatedByCrook({ pane: AGENT_PANE }))
    expect(sentRequests(yield* sent)).toEqual([
      { id: 'pane.close', method: 'pane.close', params: { pane_id: 'w1:p1' } },
    ])
  }),
)

it.effect('closes a pane crook did not create only once the close is confirmed', () =>
  Effect.gen(function* () {
    const { executor, sent } = yield* startExecutor([closed])
    const refused = yield* executor.execute(FIRST_ACTION, unconfirmedClose).pipe(Effect.flip)

    expect(refused).toEqual(new PaneNotCreatedByCrook({ pane: AGENT_PANE }))
    expect(yield* sent).toEqual([])

    const receipt = yield* executor.execute(SECOND_ACTION, confirmedClose)

    expect(receipt).toEqual(new PaneClosed({ pane: AGENT_PANE }))
    expect(yield* sent).toHaveLength(1)
  }),
)

it.effect('refuses to rename or close a pane that hosts no agent, and sends nothing', () =>
  Effect.gen(function* () {
    const { executor, sent } = yield* startExecutor([renamed, closed])
    const renameRefused = yield* executor
      .execute(FIRST_ACTION, new RenameAgent({ pane: SHELL_PANE, label: Option.some('Shell') }))
      .pipe(Effect.flip)
    const closeRefused = yield* executor
      .execute(SECOND_ACTION, new ClosePane({ pane: SHELL_PANE, confirmed: true }))
      .pipe(Effect.flip)

    expect(renameRefused).toEqual(new PaneNotAgent({ pane: SHELL_PANE }))
    expect(closeRefused).toEqual(new PaneNotAgent({ pane: SHELL_PANE }))
    expect(yield* sent).toEqual([])
  }),
)

it.effect('audits every execution, replays and refusals included, under the policy', () =>
  Effect.gen(function* () {
    const entries = yield* Queue.unbounded<AgentAuditEntry>()
    const policy = new AuditPolicy({ argumentLimit: 6, redactedArguments: ['label'] })
    const { executor } = yield* startExecutor([prompted], {
      audit: AuditLog.layerTest(entries, LAPTOP, policy),
    })

    yield* executor.execute(FIRST_ACTION, continuePrompt)
    yield* executor.execute(FIRST_ACTION, continuePrompt)
    yield* executor.execute(SECOND_ACTION, rename).pipe(Effect.flip)
    yield* executor.execute(SECOND_ACTION, unconfirmedClose).pipe(Effect.flip)
    const audited = yield* Queue.clear(entries)

    expect(
      audited.map((entry) => [entry.machine, entry.key, entry.operation, entry.arguments]),
    ).toEqual([
      [LAPTOP, FIRST_ACTION, 'Prompt', { pane: 'w1:p1', text: 'contin…' }],
      [LAPTOP, FIRST_ACTION, 'Prompt', { pane: 'w1:p1', text: 'contin…' }],
      [LAPTOP, SECOND_ACTION, 'RenameAgent', { pane: 'w1:p1', label: REDACTED }],
      [LAPTOP, SECOND_ACTION, 'ClosePane', { pane: 'w1:p1', confirmed: false }],
    ])
    expect(audited.map((entry) => [entry.outcome, entry.failure])).toEqual([
      ['succeeded', Option.none()],
      ['succeeded', Option.none()],
      ['failed', Option.some('CommandDeliveryUnknown')],
      ['failed', Option.some('PaneNotCreatedByCrook')],
    ])
  }),
)

it.effect('audits under the default policy without changing short arguments', () =>
  Effect.gen(function* () {
    const entries = yield* Queue.unbounded<AgentAuditEntry>()
    const { executor } = yield* startExecutor([keysSent], {
      audit: AuditLog.layerTest(entries, LAPTOP, AUDIT_EVERYTHING),
    })

    yield* executor.execute(FIRST_ACTION, interrupt(AGENT_PANE))

    expect((yield* Queue.clear(entries)).map((entry) => entry.arguments)).toEqual([
      { pane: 'w1:p1', keys: ['esc'] },
    ])
  }),
)
