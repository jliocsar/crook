import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunSocketServer from '@effect/platform-bun/BunSocketServer'
import { expect, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Socket from 'effect/socket/Socket'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import * as AgentDaemon from '@crook/agent/AgentDaemon'
import { CheckoutHeads } from '@crook/agent/CheckoutHeads'
import { ClaudeSessionFiles } from '@crook/agent/ClaudeSessionFiles'
import { ClaudeSessions } from '@crook/agent/ClaudeSessions'
import { CommandExecutor } from '@crook/agent/CommandExecutor'
import { CreatedPanes } from '@crook/agent/CreatedPanes'
import { GitBranches } from '@crook/agent/GitBranches'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { PendingAsks } from '@crook/agent/PendingAsks'
import { RecentPlaces } from '@crook/agent/RecentPlaces'
import { NO_RUNNING_COUNTS, RunningSubagents } from '@crook/agent/RunningSubagents'
import { Prompt } from '@crook/domain/Command'
import { ClaudeSessionId, IdempotencyKey, PaneId } from '@crook/domain/Ids'
import { type MachineState, isHerdrLost, isResync } from '@crook/domain/MachineState'
import { HerdrClient, decodeSentRequest, scriptedResult } from '@crook/herdr/HerdrClient'
import { EventsSubscribeMethod, SessionSnapshotMethod } from '@crook/herdr/Methods'
import { agentInfo, sessionSnapshot } from '@crook/herdr/fixtures/Records.ts'
import { CommandDeliveryUnknown } from '@crook/protocol/Commands'

import { discardingAudit } from './Fixtures'

type AnsweredMethods = (method: string) => boolean

const SESSION = ClaudeSessionId.make('cc70b540-d22a-4ea4-aaf9-a0db3ce151aa')

const working = sessionSnapshot([agentInfo()])

const HUNG_HERDR_TEST_LIMIT = Duration.seconds(20)

const fakeHerdrAt = Effect.fn('fakeHerdrAt')(function* (
  socketPath: string,
  answers: Ref.Ref<AnsweredMethods>,
) {
  const replies = new Map([
    [
      SessionSnapshotMethod.name,
      scriptedResult(SessionSnapshotMethod, { type: 'session_snapshot', snapshot: working }).line,
    ],
    [
      EventsSubscribeMethod.name,
      scriptedResult(EventsSubscribeMethod, { type: 'subscription_started' }).line,
    ],
  ])
  const server = yield* BunSocketServer.make({ path: socketPath })
  const subscribeAnswered = yield* Ref.make(false)
  const subscriptionQuiet = yield* Deferred.make<void>()

  yield* server
    .run((socket) =>
      Effect.gen(function* () {
        const outgoing = yield* Queue.unbounded<string>()

        yield* Stream.fromQueue(outgoing).pipe(
          Stream.pipeThroughChannel(Socket.toChannelString(socket)),
          Stream.splitLines,
          Stream.runForEach((line) =>
            Effect.gen(function* () {
              const { method } = decodeSentRequest({ method: '', line })
              const answered = yield* Ref.get(answers)
              const reply = Option.fromNullishOr(replies.get(method))

              if (answered(method) && Option.isSome(reply)) {
                yield* Queue.offer(outgoing, `${reply.value}\n`)

                if (method === EventsSubscribeMethod.name) {
                  yield* Ref.set(subscribeAnswered, true)
                }

                if (method === SessionSnapshotMethod.name && (yield* Ref.get(subscribeAnswered))) {
                  yield* Deferred.succeed(subscriptionQuiet, undefined)
                }
              }
            }),
          ),
          Effect.ignore({ log: 'Debug' }),
        )
      }),
    )
    .pipe(Effect.forkScoped)

  return subscriptionQuiet
})

const socketPathInTempFolder = Effect.fn('socketPathInTempFolder')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const folder = yield* fileSystem.makeTempDirectoryScoped()

  return `${folder}/herdr.sock`
})

const syncStageOverRealClient = (socketPath: string) =>
  Effect.map(SubscriptionRef.make(NO_RUNNING_COUNTS), (runningCounts) =>
    Layer.provideMerge(MachineStateSync.layer, [
      HerdrClient.layerAt(socketPath),
      CreatedPanes.layerTest(),
      RunningSubagents.layerTest(runningCounts, () => Effect.void),
      PendingAsks.layerTest(new Map()),
      RecentPlaces.layerTest(),
      ClaudeSessions.layerTest(new Map([['w1:p1', SESSION]])),
      ClaudeSessionFiles.layerTest(),
      GitBranches.layerTest(new Map()),
      CheckoutHeads.layerTest(),
      ConfigProvider.layer(ConfigProvider.fromUnknown({ CROOK_MACHINE_ID: 'laptop' })),
    ]),
  )

const syncOverRealClient = Effect.fn('syncOverRealClient')(function* (socketPath: string) {
  const context = yield* Layer.build(yield* syncStageOverRealClient(socketPath))

  return {
    sync: Context.get(context, MachineStateSync),
    createdPanes: Context.get(context, CreatedPanes),
  }
})

const executorOverRealClient = Effect.fn('executorOverRealClient')(function* (socketPath: string) {
  const context = yield* Layer.build(
    Layer.provideMerge(AgentDaemon.commandExecution, [
      yield* syncStageOverRealClient(socketPath),
      discardingAudit,
      BunFileSystem.layer,
      Path.layer,
    ]),
  )

  return {
    sync: Context.get(context, MachineStateSync),
    executor: Context.get(context, CommandExecutor),
  }
})

const firstStateWhere = (
  sync: MachineStateSync['Service'],
  predicate: (state: MachineState) => boolean,
) => sync.changes.pipe(Stream.filter(predicate), Stream.runHead, Effect.flatMap(Effect.fromOption))

layer(BunFileSystem.layer, { excludeTestServices: true })('Over a real herdr client', (hung) => {
  hung.effect(
    'attaches with herdr lost when herdr is not running, and fills in once it is',
    () =>
      Effect.gen(function* () {
        const socketPath = yield* socketPathInTempFolder()
        const { sync } = yield* syncOverRealClient(socketPath)
        const initial = yield* sync.current

        yield* fakeHerdrAt(socketPath, yield* Ref.make<AnsweredMethods>(() => true))

        const filled = yield* firstStateWhere(sync, (state) => !isHerdrLost(state))

        expect(initial.version).toBe(0)
        expect(isHerdrLost(initial)).toBe(true)
        expect(initial.agents).toEqual([])
        expect(filled.agents.map((row) => row.pane)).toEqual(['w1:p1'])
        expect(filled.herdrVersion).toBe('0.9.1')
        expect(isResync(initial, filled)).toBe(true)
      }),
    Duration.toMillis(HUNG_HERDR_TEST_LIMIT),
  )

  hung.effect(
    'attaches with herdr lost when herdr takes the connection and never answers the first read',
    () =>
      Effect.gen(function* () {
        const socketPath = yield* socketPathInTempFolder()

        yield* fakeHerdrAt(socketPath, yield* Ref.make<AnsweredMethods>(() => false))

        const { sync } = yield* syncOverRealClient(socketPath)

        expect(isHerdrLost(yield* sync.current)).toBe(true)
      }),
    Duration.toMillis(HUNG_HERDR_TEST_LIMIT),
  )

  hung.effect(
    'marks herdr lost when it stops answering at the subscribe',
    () =>
      Effect.gen(function* () {
        const socketPath = yield* socketPathInTempFolder()

        yield* fakeHerdrAt(
          socketPath,
          yield* Ref.make<AnsweredMethods>((method) => method === SessionSnapshotMethod.name),
        )

        const { sync } = yield* syncOverRealClient(socketPath)
        const lost = yield* firstStateWhere(sync, isHerdrLost)

        expect(lost.agents.map((row) => row.pane)).toEqual(['w1:p1'])
      }),
    Duration.toMillis(HUNG_HERDR_TEST_LIMIT),
  )

  hung.effect(
    'lets go of the state when a re-read hangs, says herdr is lost, and clears it once herdr answers',
    () =>
      Effect.gen(function* () {
        const socketPath = yield* socketPathInTempFolder()
        const answers = yield* Ref.make<AnsweredMethods>(() => true)
        const subscriptionQuiet = yield* fakeHerdrAt(socketPath, answers)
        const { sync, createdPanes } = yield* syncOverRealClient(socketPath)

        yield* Deferred.await(subscriptionQuiet)

        expect(isHerdrLost(yield* sync.current)).toBe(false)

        yield* Ref.set(answers, () => false)
        yield* sync.invalidate
        yield* createdPanes.remember(PaneId.make('w1:p1'))

        const remembered = yield* firstStateWhere(sync, (state) =>
          state.agents.some((row) => row.createdByCrook),
        )
        const lost = yield* firstStateWhere(sync, isHerdrLost)

        yield* Ref.set(answers, () => true)

        const back = yield* firstStateWhere(sync, (state) => !isHerdrLost(state))

        expect(remembered.agents.map((row) => row.createdByCrook)).toEqual([true])
        expect(lost.agents.map((row) => row.pane)).toEqual(['w1:p1'])
        expect(isResync(lost, back)).toBe(true)
      }),
    Duration.toMillis(HUNG_HERDR_TEST_LIMIT),
  )

  hung.effect(
    'says herdr is lost once a command goes unanswered over a quiet subscription, and clears it once herdr answers',
    () =>
      Effect.gen(function* () {
        const socketPath = yield* socketPathInTempFolder()
        const answers = yield* Ref.make<AnsweredMethods>(() => true)
        const subscriptionQuiet = yield* fakeHerdrAt(socketPath, answers)
        const { sync, executor } = yield* executorOverRealClient(socketPath)

        yield* Deferred.await(subscriptionQuiet)

        expect(isHerdrLost(yield* sync.current)).toBe(false)

        yield* Ref.set(answers, () => false)

        const failure = yield* executor
          .execute(
            IdempotencyKey.make('3f1c8a52-0b7e-4d0a-9a51-6f3f0d2f8e11'),
            new Prompt({ pane: PaneId.make('w1:p1'), text: 'continue' }),
          )
          .pipe(Effect.flip)
        const lost = yield* firstStateWhere(sync, isHerdrLost)

        yield* Ref.set(answers, () => true)

        const back = yield* firstStateWhere(sync, (state) => !isHerdrLost(state))

        expect(failure).toEqual(new CommandDeliveryUnknown())
        expect(lost.agents.map((row) => row.pane)).toEqual(['w1:p1'])
        expect(isResync(lost, back)).toBe(true)
      }),
    Duration.toMillis(HUNG_HERDR_TEST_LIMIT),
  )
})
