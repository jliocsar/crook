import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as TestClock from 'effect/testing/TestClock'

import { CommandExecutor, HERDR_DELIVERY_TIMEOUT } from '@crook/agent/CommandExecutor'
import { deriveAsk } from '@crook/claude/AskDerivation'
import { dialogFingerprint, parseDialog } from '@crook/claude/ScreenDialog'
import { spikeScreen } from '@crook/claude/SpikeScreens'
import {
  type Ask,
  AskQuestion,
  PermissionAsk,
  QuestionAsk,
  QuestionChoice,
  RunCommand,
  UnknownAsk,
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
  decodeSentRequest,
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
const OTHER_DEVICE_ACTION = IdempotencyKey.make('9b1c2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e')
const BASH_ASK_ID = AskId.make('toolu_01XXC3bash')
const QUESTION_ASK_ID = AskId.make('toolu_016qcolor')

const keysSent = scriptedResult(AgentSendKeysMethod, { type: 'ok' })
const prompted = scriptedResult(AgentPromptMethod, { type: 'agent_prompted' })
const delivered = new InputDelivered({ pane: AGENT_PANE, terminal: TERMINAL, stateChangeSeq: 4 })

const screenRead = (text: string) =>
  scriptedResult(PaneReadMethod, {
    type: 'pane_read',
    read: { pane_id: AGENT_PANE, text, truncated: false },
  })

const dialogOf = (text: string) => Option.map(parseDialog(text), dialogFingerprint)

const bashAsk = (screen: string, command = 'echo probe-bash-native > bash-native.txt') =>
  new PermissionAsk({
    id: BASH_ASK_ID,
    source: 'hook',
    tool: 'Bash',
    plugin: Option.none(),
    action: new RunCommand({ command }),
    options: [],
    dialog: dialogOf(screen),
  })

const questionAsk = (screen: string, multiSelect: boolean) =>
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
    dialog: dialogOf(screen),
  })

const screenAsk = (screen: string) =>
  deriveAsk({
    episode: { terminal: TERMINAL, stateChangeSeq: 4 },
    screen: Option.some(screen),
    dialog: parseDialog(screen),
    pending: [],
    toolUse: Option.none(),
  })

const startExecutor = Effect.fn('startExecutor')(function* (
  ask: Ask,
  responses: readonly ScriptedResponse[],
) {
  const blocked = machineStateWith([agentRow({ status: 'blocked', ask: Option.some(ask) })])
  const state = yield* SubscriptionRef.make(blocked)
  const sent = yield* Queue.unbounded<SentRequest>()
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const invalidations = yield* Ref.make(0)
  const context = yield* Layer.build(
    executorWith(HerdrClient.layerTest({ responses, events, sent }), state, {
      invalidate: Ref.update(invalidations, (count) => count + 1),
    }),
  )

  return { executor: Context.get(context, CommandExecutor), sent, state, invalidations }
})

const startOverQueuedScreens = Effect.fn('startOverQueuedScreens')(function* (
  ask: Ask,
  answeredScreen: string,
  nextScreen: string,
) {
  const blocked = machineStateWith([agentRow({ status: 'blocked', ask: Option.some(ask) })])
  const state = yield* SubscriptionRef.make(blocked)
  const sent = yield* Queue.unbounded<SentRequest>()
  const events = yield* Queue.unbounded<HerdrEvent, HerdrSubscriptionError>()
  const herdr = yield* HerdrClient.makeSwitchingTest({
    responses: [screenRead(answeredScreen), keysSent],
    events,
    sent,
  })
  const context = yield* Layer.build(executorWith(herdr.layer, state))

  return {
    executor: Context.get(context, CommandExecutor),
    sent,
    state,
    showNext: herdr.respondWith([screenRead(nextScreen), keysSent]),
  }
})

const answer = (ask: Ask, given: AskAnswer) =>
  new AnswerAsk({ pane: AGENT_PANE, ask: ask.id, answer: given })

const sentAfter = (sent: Queue.Queue<SentRequest>) =>
  Effect.map(Queue.clear(sent), (requests) => requests.map(decodeSentRequest))

const keysRequest = (keys: readonly string[]) => ({
  method: 'agent.send_keys',
  params: { target: 'w1:p1', keys },
})

const READ_REQUEST = { method: 'pane.read', params: { pane_id: 'w1:p1', source: 'detection' } }

layer(BunFileSystem.layer)('AnswerAsk', (it) => {
  it.effect('approves by confirming the Yes option the cursor already rests on', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('12-native-bash-t20')
      const ask = bashAsk(screen)
      const { executor, sent } = yield* startExecutor(ask, [screenRead(screen), keysSent])
      const receipt = yield* executor.execute(ACTION, answer(ask, new Approve({})))

      expect(receipt).toEqual(delivered)
      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST, keysRequest(['enter'])])
    }),
  )

  it.effect('approves always by moving down to the always-allow option', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('12-native-bash-t20')
      const ask = bashAsk(screen)
      const { executor, sent } = yield* startExecutor(ask, [screenRead(screen), keysSent])

      yield* executor.execute(ACTION, answer(ask, new ApproveAlways({})))

      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST, keysRequest(['down', 'enter'])])
    }),
  )

  it.effect('approves always through a don’t-ask-again option', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('105-npm-dont-ask-again')
      const ask = bashAsk(screen, 'npm --version')
      const { executor, sent } = yield* startExecutor(ask, [screenRead(screen), keysSent])

      yield* executor.execute(ACTION, answer(ask, new ApproveAlways({})))

      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST, keysRequest(['down', 'enter'])])
    }),
  )

  it.effect('declines with Esc once the screen still shows the dialog', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('12-native-bash-t20')
      const ask = bashAsk(screen)
      const { executor, sent } = yield* startExecutor(ask, [screenRead(screen), keysSent])

      yield* executor.execute(ACTION, answer(ask, new Decline({ message: Option.none() })))

      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST, keysRequest(['esc'])])
    }),
  )

  it.effect('declines with a message by pressing Esc, then prompting once the dialog is gone', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('12-native-bash-t20')
      const ask = bashAsk(screen)
      const { executor, sent, state } = yield* startExecutor(ask, [
        screenRead(screen),
        keysSent,
        prompted,
      ])
      const declined = answer(ask, new Decline({ message: Option.some('use printf') }))
      const running = yield* executor.execute(ACTION, declined).pipe(Effect.forkChild)
      const read = decodeSentRequest(yield* Queue.take(sent))
      const esc = decodeSentRequest(yield* Queue.take(sent))

      yield* SubscriptionRef.set(state, machineStateWith([agentRow({ status: 'idle' })]))
      const receipt = yield* Fiber.join(running)

      expect([read, esc]).toEqual([READ_REQUEST, keysRequest(['esc'])])
      expect(receipt).toEqual(delivered)
      expect(yield* sentAfter(sent)).toEqual([
        { method: 'agent.prompt', params: { target: 'w1:p1', text: 'use printf' } },
      ])
    }),
  )

  it.effect('reports an undelivered decline message once, and never presses Esc again for it', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('12-native-bash-t20')
      const ask = bashAsk(screen)
      const { executor, sent } = yield* startExecutor(ask, [screenRead(screen), keysSent, prompted])
      const declined = answer(ask, new Decline({ message: Option.some('use printf') }))
      const running = yield* executor.execute(ACTION, declined).pipe(Effect.forkChild)

      yield* Queue.take(sent)
      yield* Queue.take(sent)
      yield* TestClock.adjust(HERDR_DELIVERY_TIMEOUT)
      const failure = yield* Fiber.join(running).pipe(Effect.flip)
      const retried = yield* executor.execute(ACTION, declined).pipe(Effect.flip)

      expect(failure).toEqual(
        new DeclineMessageUndelivered({
          pane: AGENT_PANE,
          reason: 'the agent still looked blocked after Esc',
        }),
      )
      expect(retried).toEqual(failure)
      expect(yield* sentAfter(sent)).toEqual([])
    }),
  )

  it.effect('refuses an answer to an ask the agent no longer shows, and sends nothing', () =>
    Effect.gen(function* () {
      const ask = bashAsk(yield* spikeScreen('12-native-bash-t20'))
      const { executor, sent } = yield* startExecutor(ask, [keysSent])
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

  it.effect('refuses to approve a dialog that replaced the one the ask was read from', () =>
    Effect.gen(function* () {
      const ask = bashAsk(yield* spikeScreen('40-parallel-blocked-1'), 'echo par-a > par-a.txt')
      const replaced = yield* spikeScreen('42-parallel-blocked-2')
      const { executor, sent, invalidations } = yield* startExecutor(ask, [
        screenRead(replaced),
        keysSent,
      ])
      const refused = yield* executor
        .execute(ACTION, answer(ask, new Approve({})))
        .pipe(Effect.flip)

      expect(refused).toEqual(new AskNotPending({ pane: AGENT_PANE, ask: ask.id }))
      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST])
      expect(yield* Ref.get(invalidations)).toBe(1)
    }),
  )

  it.effect('answers an ask once, whichever device answers it again', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('12-native-bash-t20')
      const ask = bashAsk(screen)
      const { executor, sent, invalidations } = yield* startExecutor(ask, [
        screenRead(screen),
        keysSent,
      ])
      const first = executor.execute(ACTION, answer(ask, new Approve({})))
      const second = executor.execute(OTHER_DEVICE_ACTION, answer(ask, new Approve({})))
      const [approved, refused] = yield* Effect.all([first, Effect.flip(second)], {
        concurrency: 'unbounded',
      })

      expect(approved).toEqual(delivered)
      expect(refused).toEqual(new AskNotPending({ pane: AGENT_PANE, ask: ask.id }))
      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST, keysRequest(['enter'])])
      expect(yield* Ref.get(invalidations)).toBe(1)
    }),
  )

  it.effect('answers the next queued dialog though it shows the command just answered', () =>
    Effect.gen(function* () {
      const answeredScreen = yield* spikeScreen('112-codemode6-zombie')
      const nextScreen = yield* spikeScreen('113-codemode6-zombie-declined')
      const answered = screenAsk(answeredScreen)
      const next = screenAsk(nextScreen)
      const { executor, sent, state, showNext } = yield* startOverQueuedScreens(
        answered,
        answeredScreen,
        nextScreen,
      )

      yield* executor.execute(ACTION, answer(answered, new Approve({})))
      yield* showNext
      yield* SubscriptionRef.set(
        state,
        machineStateWith([agentRow({ status: 'blocked', ask: Option.some(next) })]),
      )
      const receipt = yield* executor.execute(OTHER_DEVICE_ACTION, answer(next, new Approve({})))

      expect(next.id).not.toBe(answered.id)
      expect(receipt).toEqual(delivered)
      expect(yield* sentAfter(sent)).toEqual([
        READ_REQUEST,
        keysRequest(['enter']),
        READ_REQUEST,
        keysRequest(['enter']),
      ])
    }),
  )

  it.effect('re-reads the herd when the agent stays blocked after an answer', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('112-codemode6-zombie')
      const ask = screenAsk(screen)
      const { executor, invalidations } = yield* startExecutor(ask, [screenRead(screen), keysSent])

      yield* executor.execute(ACTION, answer(ask, new Approve({})))
      const beforeRedraw = yield* Ref.get(invalidations)
      yield* TestClock.adjust(HERDR_DELIVERY_TIMEOUT)
      const afterRedraw = yield* Ref.get(invalidations)

      expect([beforeRedraw, afterRedraw]).toEqual([0, 1])
    }),
  )

  it.effect('leaves the herd to herdr when the agent leaves blocked after an answer', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('12-native-bash-t20')
      const ask = bashAsk(screen)
      const { executor, state, invalidations } = yield* startExecutor(ask, [
        screenRead(screen),
        keysSent,
      ])

      yield* executor.execute(ACTION, answer(ask, new Approve({})))
      yield* SubscriptionRef.set(state, machineStateWith([agentRow({ status: 'working' })]))
      yield* TestClock.adjust(HERDR_DELIVERY_TIMEOUT)

      expect(yield* Ref.get(invalidations)).toBe(0)
    }),
  )

  it.effect('picks the answer to a single-choice question by its label', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('80-ask-blocked')
      const ask = questionAsk(screen, false)
      const { executor, sent } = yield* startExecutor(ask, [screenRead(screen), keysSent])

      yield* executor.execute(ACTION, answer(ask, new Choose({ answer: 'Green' })))

      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST, keysRequest(['down', 'enter'])])
    }),
  )

  it.effect('refuses a multi-select question rather than guess its keys', () =>
    Effect.gen(function* () {
      const ask = questionAsk(yield* spikeScreen('80-ask-blocked'), true)
      const { executor, sent } = yield* startExecutor(ask, [keysSent])
      const refused = yield* executor
        .execute(ACTION, answer(ask, new Choose({ answer: 'Green' })))
        .pipe(Effect.flip)

      expect(refused).toEqual(new QuestionnaireUnsupported({ pane: AGENT_PANE }))
      expect(yield* sentAfter(sent)).toEqual([])
    }),
  )

  it.effect('refuses a choice the question does not offer, before reading the screen', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('80-ask-blocked')
      const ask = questionAsk(screen, false)
      const { executor, sent } = yield* startExecutor(ask, [screenRead(screen), keysSent])
      const refused = yield* Effect.all(
        ['Purple', 'Type something.'].map((label) =>
          executor.execute(ACTION, answer(ask, new Choose({ answer: label }))).pipe(Effect.flip),
        ),
      )

      expect(refused).toEqual([
        new AskOptionUnavailable({ pane: AGENT_PANE, option: 'Purple' }),
        new AskOptionUnavailable({ pane: AGENT_PANE, option: 'Type something.' }),
      ])
      expect(yield* sentAfter(sent)).toEqual([])
    }),
  )

  it.effect('offers no choice by label on a permission, so a mode switch cannot be picked', () =>
    Effect.gen(function* () {
      const screen = yield* spikeScreen('12-native-bash-t20')
      const ask = bashAsk(screen)
      const { executor, sent } = yield* startExecutor(ask, [screenRead(screen), keysSent])
      const option = 'Yes, and switch to auto mode · auto mode handles these prompts for you'
      const refused = yield* executor
        .execute(ACTION, answer(ask, new Choose({ answer: option })))
        .pipe(Effect.flip)

      expect(refused).toEqual(new AskOptionUnavailable({ pane: AGENT_PANE, option }))
      expect(yield* sentAfter(sent)).toEqual([])
    }),
  )

  it.effect('sends no key when the screen shows no dialog it can read', () =>
    Effect.gen(function* () {
      const ask = new UnknownAsk({ id: AskId.make('blocked-term_1-4'), screen: '❯ \n' })
      const { executor, sent } = yield* startExecutor(ask, [screenRead('❯ \n'), keysSent])
      const refused = yield* executor
        .execute(ACTION, answer(ask, new Approve({})))
        .pipe(Effect.flip)

      expect(refused).toEqual(new AskDialogUnreadable({ pane: AGENT_PANE }))
      expect(yield* sentAfter(sent)).toEqual([READ_REQUEST])
    }),
  )
})
