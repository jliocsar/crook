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

import { MachineStateSync } from '@crook/agent/MachineStateSync'
import { type OpenTasks, TaskLiveness } from '@crook/agent/TaskLiveness'
import { TranscriptStreams } from '@crook/agent/TranscriptStreams'
import { BackgroundWork } from '@crook/claude/BackgroundWork'
import { SkillCatalog } from '@crook/claude/SkillCatalog'
import { SubagentRoster } from '@crook/claude/SubagentRoster'
import { TranscriptLocator } from '@crook/claude/TranscriptLocator'
import { TranscriptTail } from '@crook/claude/TranscriptTail'
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
  const context = yield* Layer.build(
    Layer.provide(TranscriptStreams.layerWithoutDependencies, [
      TranscriptLocator.layerAt([root]),
      TranscriptTail.layer,
      SubagentRoster.layer,
      SkillCatalog.layerAt([root], []),
      BackgroundWork.layer,
      liveness,
      MachineStateSync.layerTest(state),
    ]),
  )

  return Context.get(context, TranscriptStreams)
})

layer(Layer.mergeAll(BunFileSystem.layer, Path.layer))(
  'TranscriptStreams background work',
  (it) => {
    it.effect('rechecks a running shell and tells the phone once its process is gone', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* fileSystem.makeTempDirectoryScoped()

        yield* fileSystem.makeDirectory(`${root}/projects/${PROJECT}`, { recursive: true })
        yield* fileSystem.writeFileString(
          `${root}/projects/${PROJECT}/${SESSION}.jsonl`,
          devServerLaunch,
        )

        const open = yield* Ref.make<OpenTasks>(Option.some(HashSet.make(TASK)))
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

        expect(yield* Queue.take(states)).toBe(`${TASK} alive`)

        yield* Ref.set(open, Option.some(HashSet.empty()))
        yield* TestClock.adjust(`${LIVENESS_RECHECK_SECONDS} seconds`)

        expect(yield* Queue.take(states)).toBe(`${TASK} gone`)
      }),
    )
  },
)
