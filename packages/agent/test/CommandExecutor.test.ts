import { expect, it } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { CommandExecutor } from '@crook/agent/CommandExecutor'
import { CommandPolicy } from '@crook/agent/CommandPolicy'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { InputDelivered, Prompt, SendKeys, interrupt } from '@crook/domain/Command'
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
import { AgentPromptMethod, AgentSendKeysMethod } from '@crook/herdr/Methods'
import {
  CommandDeliveryUnknown,
  HerdrRefusedCommand,
  HerdrUnavailable,
  PaneNotAgent,
} from '@crook/protocol/Commands'

import { agentRow, machineStateWith } from './Fixtures'

const AGENT_PANE = PaneId.make('w1:p1')
const SHELL_PANE = PaneId.make('w1:p2')
const FIRST_ACTION = IdempotencyKey.make('3f1c8a52-0b7e-4d0a-9a51-6f3f0d2f8e11')
const SECOND_ACTION = IdempotencyKey.make('9b2e4d17-5c6a-4f81-8e0d-2a7c1b9f4e63')

const prompted = scriptedResult(AgentPromptMethod, { type: 'agent_prompted' })
const keysSent = scriptedResult(AgentSendKeysMethod, { type: 'ok' })
const continuePrompt = new Prompt({ pane: AGENT_PANE, text: 'continue' })
const delivered = new InputDelivered({ pane: AGENT_PANE, stateChangeSeq: 4 })

const SentLine = Schema.fromJsonString(
  Schema.Struct({ id: Schema.String, method: Schema.String, params: Schema.Unknown }),
)

const sentRequests = (requests: readonly SentRequest[]) =>
  requests.map((request) => Schema.decodeSync(SentLine)(request.line))

const executorWith = (
  herdr: Layer.Layer<HerdrClient>,
  state: SubscriptionRef.SubscriptionRef<ReturnType<typeof machineStateWith>>,
) => {
  const policy = Layer.provide(CommandPolicy.layer, MachineStateSync.layerTest(state))

  return Layer.provide(CommandExecutor.layer, [policy, herdr])
}

const startExecutor = Effect.fn('startExecutor')(function* (
  responses: readonly ScriptedResponse[],
) {
  const state = yield* SubscriptionRef.make(machineStateWith([agentRow()]))
  const sent = yield* Queue.unbounded<SentRequest>()
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const context = yield* Layer.build(
    executorWith(HerdrClient.layerTest({ responses, events, sent }), state),
  )

  return { executor: Context.get(context, CommandExecutor), sent: Queue.clear(sent), state }
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
    expect(fresh).toEqual(new InputDelivered({ pane: AGENT_PANE, stateChangeSeq: 5 }))
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

    expect(receipt).toEqual(new InputDelivered({ pane: SHELL_PANE, stateChangeSeq: 1 }))
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
