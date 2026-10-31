import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import * as TestClock from 'effect/testing/TestClock'

import * as AgentDaemon from '@crook/agent/AgentDaemon'
import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { type OpenTasks, TaskLiveness } from '@crook/agent/TaskLiveness'
import { TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { BackgroundWork } from '@crook/claude/BackgroundWork'
import { SkillCatalog } from '@crook/claude/SkillCatalog'
import { ClaudeSessionId } from '@crook/domain/Ids'
import { PaneTranscript, type TranscriptEvent } from '@crook/domain/Transcript'

import { agentRow, machineStateWith } from './Fixtures'

const SESSION = ClaudeSessionId.make('309f44d5-235f-4550-a0c7-1691715aad75')
const PROJECT = '-home-jliocsar-Projects-crook'
const TASK = 'bdev1'
const LIVENESS_RECHECK_SECONDS = 5

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const devServerLaunch = [
  encodeJson({
    type: 'assistant',
    uuid: 'assistant-dev',
    timestamp: '2026-10-30T14:00:00.000Z',
    message: {
      id: 'msg_dev',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_dev',
          name: 'Bash',
          input: { command: 'bun run dev', run_in_background: true },
        },
      ],
    },
  }),
  encodeJson({
    type: 'user',
    uuid: 'user-dev',
    timestamp: '2026-10-30T14:00:01.000Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_dev',
          content: `Command running in background with ID: ${TASK}. Output is being written to: /nowhere/tasks/${TASK}.output.`,
        },
      ],
    },
    toolUseResult: { backgroundTaskId: TASK },
  }),
  '',
].join('\n')

const outputRead = (id: string, second: number) =>
  [
    encodeJson({
      type: 'assistant',
      uuid: `assistant-${id}`,
      timestamp: `2026-10-30T14:01:${String(second).padStart(2, '0')}.000Z`,
      message: {
        id: `msg_${id}`,
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: `toolu_${id}`,
            name: 'Read',
            input: { file_path: `/nowhere/tasks/${TASK}.output` },
          },
        ],
      },
    }),
    '',
  ].join('\n')

const aliveOf = (event: TranscriptEvent): Option.Option<string> =>
  Match.value(event).pipe(
    Match.tag('BackgroundChanged', (changed) =>
      Option.some(
        changed.tasks
          .map((task) =>
            Match.value(task).pipe(
              Match.tag(
                'ShellTask',
                (shell) =>
                  `${shell.taskId} ${Option.match(shell.alive, { onNone: () => 'unknown', onSome: (alive) => (alive ? 'alive' : 'gone') })}`,
              ),
              Match.orElse(() => task.taskId),
            ),
          )
          .join(','),
      ),
    ),
    Match.orElse(() => Option.none()),
  )

const streamsWith = Effect.fn('streamsWith')(function* (root: string, open: Ref.Ref<OpenTasks>) {
  const state = yield* SubscriptionRef.make(
    machineStateWith([agentRow({ claudeSession: Option.some(SESSION) })]),
  )
  const liveness = Layer.succeed(TaskLiveness, TaskLiveness.of({ openTasks: () => Ref.get(open) }))
  const backgroundWork = Layer.provideMerge(
    BackgroundWork.layer,
    AgentDaemon.transcriptReadersAt([root]),
  )
  const context = yield* Layer.build(
    Layer.provide(TranscriptStreams.layer, [
      backgroundWork,
      SkillCatalog.layerAt([root], []),
      liveness,
      MachineStateSync.layerTest(state),
    ]),
  )

  return Context.get(context, TranscriptStreams)
})

const following = Effect.fn('following')(function* (
  liveness: OpenTasks = Option.some(HashSet.make(TASK)),
) {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()
  const transcript = `${root}/projects/${PROJECT}/${SESSION}.jsonl`

  yield* fileSystem.makeDirectory(`${root}/projects/${PROJECT}`, { recursive: true })
  yield* fileSystem.writeFileString(transcript, devServerLaunch)

  const open = yield* Ref.make(liveness)
  const streams = yield* streamsWith(root, open)
  const states = yield* Queue.unbounded<string>()

  yield* streams
    .follow(new PaneTranscript({ pane: agentRow({}).pane }), Option.none(), Option.none())
    .pipe(
      Stream.map(aliveOf),
      Stream.filter(Option.isSome),
      Stream.map((line) => line.value),
      Stream.runForEach((line) => Queue.offer(states, line)),
      Effect.forkScoped,
    )

  return { open, states, transcript }
})

layer(Layer.mergeAll(BunFileSystem.layer, Path.layer))(
  'TranscriptStreams background work',
  (it) => {
    it.effect('rechecks a running shell and tells the phone once its process is gone', () =>
      Effect.gen(function* () {
        const { open, states } = yield* following()

        expect(yield* Queue.take(states)).toBe(`${TASK} alive`)

        yield* Ref.set(open, Option.some(HashSet.empty()))
        yield* TestClock.adjust(`${LIVENESS_RECHECK_SECONDS} seconds`)
        yield* TestClock.adjust(`${LIVENESS_RECHECK_SECONDS} seconds`)

        expect(yield* Queue.take(states)).toBe(`${TASK} gone`)
      }),
    )

    it.effect(
      'waits a full recheck before calling a shell gone, however often the work changes',
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const { open, states, transcript } = yield* following()

          expect(yield* Queue.take(states)).toBe(`${TASK} alive`)

          yield* Ref.set(open, Option.some(HashSet.empty()))
          yield* fileSystem.writeFileString(transcript, outputRead('first', 10), { flag: 'a' })

          expect(yield* Queue.take(states)).toBe(`${TASK} alive`)

          yield* fileSystem.writeFileString(transcript, outputRead('second', 20), { flag: 'a' })

          expect(yield* Queue.take(states)).toBe(`${TASK} alive`)

          yield* TestClock.adjust(`${LIVENESS_RECHECK_SECONDS} seconds`)

          expect(yield* Queue.take(states)).toBe(`${TASK} gone`)
        }),
    )

    it.effect('never calls a shell gone on a system it cannot check, such as macOS', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const { states, transcript } = yield* following(Option.none())

        expect(yield* Queue.take(states)).toBe(`${TASK} unknown`)

        yield* TestClock.adjust(`${LIVENESS_RECHECK_SECONDS} seconds`)
        yield* TestClock.adjust(`${LIVENESS_RECHECK_SECONDS} seconds`)
        yield* TestClock.adjust(`${LIVENESS_RECHECK_SECONDS} seconds`)
        yield* fileSystem.writeFileString(transcript, outputRead('later', 30), { flag: 'a' })

        expect(yield* Queue.take(states)).toBe(`${TASK} unknown`)
      }),
    )
  },
)
