import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as TestClock from 'effect/testing/TestClock'

import { CommandExecutor, HERDR_DELIVERY_TIMEOUT } from '@crook/agent/CommandExecutor'
import {
  type Ask,
  AskQuestion,
  PermissionAsk,
  QuestionAsk,
  QuestionChoice,
  RunCommand,
} from '@crook/domain/Ask'
import {
  AnswerAsk,
  Approve,
  ApproveAlways,
  type AskAnswer,
  Choose,
  Decline,
  InputDelivered,
} from '@crook/domain/Command'
import { AskId, IdempotencyKey, PaneId } from '@crook/domain/Ids'
import type { HerdrEvent } from '@crook/herdr/Events'
import {
  HerdrClient,
  type HerdrSubscriptionError,
  type ScriptedResponse,
  type SentRequest,
  scriptedResult,
} from '@crook/herdr/HerdrClient'
import { AgentPromptMethod, AgentSendKeysMethod, PaneReadMethod } from '@crook/herdr/Methods'
import {
  AskDialogUnreadable,
  AskNotPending,
  AskOptionUnavailable,
  DeclineMessageUndelivered,
  QuestionnaireUnsupported,
} from '@crook/protocol/Commands'

import { TERMINAL, agentRow, executorWith, machineStateWith } from './Fixtures'

const AGENT_PANE = PaneId.make('w1:p1')
const ACTION = IdempotencyKey.make('5d0e7c1a-2b3f-4a6d-8c9e-1f2a3b4c5d6e')
const BASH_ASK_ID = AskId.make('toolu_01XXC3bash')
const QUESTION_ASK_ID = AskId.make('toolu_016qcolor')

const keysSent = scriptedResult(AgentSendKeysMethod, { type: 'ok' })
const prompted = scriptedResult(AgentPromptMethod, { type: 'agent_prompted' })
const delivered = new InputDelivered({ pane: AGENT_PANE, terminal: TERMINAL, stateChangeSeq: 4 })

const bashAsk = new PermissionAsk({
  id: BASH_ASK_ID,
  source: 'hook',
  tool: 'Bash',
  plugin: Option.none(),
  action: new RunCommand({ command: 'echo probe-bash-native > bash-native.txt' }),
  options: [],
})

const questionAsk = (multiSelect: boolean) =>
  new QuestionAsk({
    id: QUESTION_ASK_ID,
    source: 'hook',
    questions: [
      new AskQuestion({
        header: 'Color',
        question: 'Which color do you prefer?',
        multiSelect: Option.some(multiSelect),
        choices: ['Red', 'Green', 'Blue'].map(
          (label) => new QuestionChoice({ label, description: Option.none() }),
        ),
      }),
    ],
  })

const SentLine = Schema.fromJsonString(
  Schema.Struct({ method: Schema.String, params: Schema.Unknown }),
)

const sentRequest = (request: SentRequest) => Schema.decodeSync(SentLine)(request.line)

const screenRead = Effect.fn('screenRead')(function* (name: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const text = yield* fileSystem.readFileString(
    `${import.meta.dirname}/fixtures/spike-80/screens/${name}.txt`,
  )

  return scriptedResult(PaneReadMethod, {
    type: 'pane_read',
    read: { pane_id: AGENT_PANE, text, truncated: false },
  })
})

const startExecutor = Effect.fn('startExecutor')(function* (
  ask: Ask,
  responses: readonly ScriptedResponse[],
) {
  const blocked = machineStateWith([agentRow({ status: 'blocked', ask: Option.some(ask) })])
  const state = yield* SubscriptionRef.make(blocked)
  const sent = yield* Queue.unbounded<SentRequest>()
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const context = yield* Layer.build(
    executorWith(HerdrClient.layerTest({ responses, events, sent }), state),
  )

  return { executor: Context.get(context, CommandExecutor), sent, state }
})

const answer = (ask: Ask, given: AskAnswer) =>
  new AnswerAsk({ pane: AGENT_PANE, ask: ask.id, answer: given })

const sentAfter = (sent: Queue.Queue<SentRequest>) =>
  Effect.map(Queue.clear(sent), (requests) => requests.map(sentRequest))

const keysRequest = (keys: readonly string[]) => ({
  method: 'agent.send_keys',
  params: { target: 'w1:p1', keys },
})

const READ_REQUEST = { method: 'pane.read', params: { pane_id: 'w1:p1', source: 'detection' } }

layer(BunFileSystem.layer)('AnswerAsk', (it) => {
  it.effect('approves by confirming the Yes option the cursor already rests on', () =>
    Effect.gen(function* () {
      const { executor, sent } = yield* startExecutor(bashAsk, [
        yield* screenRead('12-native-bash-t20'),
        keysSent,
      ])
      const receipt = yield* executor.execute(ACTION, answer(bashAsk, new Approve({})))

      expect(receipt).toEqual(delivered)
      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST, keysRequest(['enter'])])
    }),
  )

  it.effect('approves always by moving down to the always-allow option', () =>
    Effect.gen(function* () {
      const { executor, sent } = yield* startExecutor(bashAsk, [
        yield* screenRead('12-native-bash-t20'),
        keysSent,
      ])

      yield* executor.execute(ACTION, answer(bashAsk, new ApproveAlways({})))

      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST, keysRequest(['down', 'enter'])])
    }),
  )

  it.effect('declines with Esc, without reading the screen', () =>
    Effect.gen(function* () {
      const { executor, sent } = yield* startExecutor(bashAsk, [keysSent])

      yield* executor.execute(ACTION, answer(bashAsk, new Decline({ message: Option.none() })))

      expect(yield* sentAfter(sent)).toEqual([keysRequest(['esc'])])
    }),
  )

  it.effect('declines with a message by pressing Esc, then prompting once the dialog is gone', () =>
    Effect.gen(function* () {
      const { executor, sent, state } = yield* startExecutor(bashAsk, [keysSent, prompted])
      const declined = answer(bashAsk, new Decline({ message: Option.some('use printf') }))
      const running = yield* executor.execute(ACTION, declined).pipe(Effect.forkChild)
      const esc = sentRequest(yield* Queue.take(sent))

      yield* SubscriptionRef.set(state, machineStateWith([agentRow({ status: 'idle' })]))
      const receipt = yield* Fiber.join(running)

      expect(esc).toEqual(keysRequest(['esc']))
      expect(receipt).toEqual(delivered)
      expect(yield* sentAfter(sent)).toEqual([
        { method: 'agent.prompt', params: { target: 'w1:p1', text: 'use printf' } },
      ])
    }),
  )

  it.effect('reports a decline message it could not deliver while the agent stays blocked', () =>
    Effect.gen(function* () {
      const { executor, sent } = yield* startExecutor(bashAsk, [keysSent, prompted])
      const declined = answer(bashAsk, new Decline({ message: Option.some('use printf') }))
      const running = yield* executor.execute(ACTION, declined).pipe(Effect.forkChild)

      yield* Queue.take(sent)
      yield* TestClock.adjust(HERDR_DELIVERY_TIMEOUT)
      const failure = yield* Fiber.join(running).pipe(Effect.flip)

      expect(failure).toEqual(
        new DeclineMessageUndelivered({
          pane: AGENT_PANE,
          reason: 'the agent still looked blocked after Esc',
        }),
      )
      expect(yield* sentAfter(sent)).toEqual([])
    }),
  )

  it.effect('refuses an answer to an ask the agent no longer shows, and sends nothing', () =>
    Effect.gen(function* () {
      const { executor, sent } = yield* startExecutor(bashAsk, [keysSent])
      const stale = new AnswerAsk({
        pane: AGENT_PANE,
        ask: AskId.make('toolu_earlier'),
        answer: new Approve({}),
      })
      const refused = yield* executor.execute(ACTION, stale).pipe(Effect.flip)

      expect(refused).toEqual(new AskNotPending({ pane: AGENT_PANE, ask: stale.ask }))
      expect(yield* sentAfter(sent)).toEqual([])
    }),
  )

  it.effect('picks the answer to a single-choice question by its label', () =>
    Effect.gen(function* () {
      const ask = questionAsk(false)
      const { executor, sent } = yield* startExecutor(ask, [
        yield* screenRead('80-ask-blocked'),
        keysSent,
      ])

      yield* executor.execute(ACTION, answer(ask, new Choose({ answers: ['Green'] })))

      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST, keysRequest(['down', 'enter'])])
    }),
  )

  it.effect('refuses a multi-select question rather than guess its keys', () =>
    Effect.gen(function* () {
      const ask = questionAsk(true)
      const { executor, sent } = yield* startExecutor(ask, [keysSent])
      const refused = yield* executor
        .execute(ACTION, answer(ask, new Choose({ answers: ['Green'] })))
        .pipe(Effect.flip)

      expect(refused).toEqual(new QuestionnaireUnsupported({ pane: AGENT_PANE }))
      expect(yield* sentAfter(sent)).toEqual([])
    }),
  )

  it.effect('refuses a choice the dialog does not offer, after reading it', () =>
    Effect.gen(function* () {
      const ask = questionAsk(false)
      const { executor, sent } = yield* startExecutor(ask, [
        yield* screenRead('80-ask-blocked'),
        keysSent,
      ])
      const refused = yield* executor
        .execute(ACTION, answer(ask, new Choose({ answers: ['Purple'] })))
        .pipe(Effect.flip)

      expect(refused).toEqual(new AskOptionUnavailable({ pane: AGENT_PANE, option: 'Purple' }))
      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST])
    }),
  )

  it.effect('sends no key when the screen shows no dialog it can read', () =>
    Effect.gen(function* () {
      const idleScreen = scriptedResult(PaneReadMethod, {
        type: 'pane_read',
        read: { pane_id: AGENT_PANE, text: '❯ \n', truncated: false },
      })
      const { executor, sent } = yield* startExecutor(bashAsk, [idleScreen, keysSent])
      const refused = yield* executor
        .execute(ACTION, answer(bashAsk, new Approve({})))
        .pipe(Effect.flip)

      expect(refused).toEqual(new AskDialogUnreadable({ pane: AGENT_PANE }))
      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST])
    }),
  )
})
