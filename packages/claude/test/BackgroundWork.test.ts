import { describe, expect, it, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { BackgroundWork, outputLines, type BackgroundSnapshot } from '@crook/claude/BackgroundWork'
import { TranscriptFile, subagentsDirectoryOf } from '@crook/claude/TranscriptLocator'
import { SubagentId } from '@crook/domain/Ids'

import { SESSION, WATCHERS_SETTLED, services as transcriptServices } from './Fixtures'

const TASK = 'bq8qlvs1g'
const SHELL_TOOL_USE = 'toolu_01Gh5VNRXuFcVHuXR7pdXaBH'
const SUBAGENT = SubagentId.make('a3220895dbc2e067c')
const ESCAPE = String.fromCodePoint(0x1b)

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const line = (json: Schema.Json) => `${encodeJson(json)}\n`

const launchLines = (outputFile: string) =>
  line({
    type: 'assistant',
    timestamp: '2026-09-28T17:16:41.615Z',
    message: {
      content: [
        {
          type: 'tool_use',
          id: SHELL_TOOL_USE,
          name: 'Bash',
          input: {
            command: 'bun run dev',
            description: 'Dev server',
            run_in_background: true,
          },
        },
      ],
    },
  }) +
  line({
    type: 'user',
    timestamp: '2026-09-28T17:16:46.511Z',
    message: {
      content: [
        {
          tool_use_id: SHELL_TOOL_USE,
          type: 'tool_result',
          content: `Command running in background with ID: ${TASK}. Output is being written to: ${outputFile}. You will be notified when it completes.`,
        },
      ],
    },
    toolUseResult: { stdout: '', stderr: '', backgroundTaskId: TASK },
  })

const noticeLine = line({
  type: 'user',
  timestamp: '2026-09-28T18:01:06.315Z',
  message: {
    content: `<task-notification>\n<task-id>${TASK}</task-id>\n<tool-use-id>${SHELL_TOOL_USE}</tool-use-id>\n<status>killed</status>\n<summary>Background command "Dev server" was stopped by the user</summary>\n</task-notification>`,
  },
})

const subagentStep = (timestamp: string, block: Schema.Json) =>
  line({ type: 'assistant', timestamp, message: { content: [block] } })

const services = Layer.provideMerge(BackgroundWork.layer, transcriptServices)

const scratch = Effect.fn('scratch')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fileSystem.makeTempDirectoryScoped()
  const file = new TranscriptFile({ session: SESSION, path: `${directory}/${SESSION}.jsonl` })
  const outputFile = `${directory}/tasks/${TASK}.output`

  yield* fileSystem.makeDirectory(`${directory}/tasks`)
  yield* fileSystem.writeFileString(outputFile, '$ vite\nready in 412 ms\n')
  yield* fileSystem.writeFileString(file.path, launchLines(outputFile))

  return { file, outputFile, subagents: subagentsDirectoryOf(path, file) }
})

const watching = Effect.fn('watching')(function* (file: TranscriptFile) {
  const work = yield* BackgroundWork
  const snapshots = yield* Queue.unbounded<BackgroundSnapshot>()

  yield* work.watch(file).pipe(
    Stream.runForEach((snapshot) => Queue.offer(snapshots, snapshot)),
    Effect.forkScoped,
  )

  return snapshots
})

const shellOf = (snapshot: BackgroundSnapshot) =>
  snapshot.tasks.map((task) => ({
    status: task.status,
    output: Match.value(task).pipe(
      Match.tag('ShellTask', (shell) => shell.output),
      Match.orElse(() => []),
    ),
  }))

const takeWhere = (
  snapshots: Queue.Queue<BackgroundSnapshot>,
  wanted: (snapshot: BackgroundSnapshot) => boolean,
): Effect.Effect<BackgroundSnapshot> =>
  Effect.flatMap(Queue.take(snapshots), (snapshot) =>
    wanted(snapshot) ? Effect.succeed(snapshot) : takeWhere(snapshots, wanted),
  )

layer(services, { excludeTestServices: true })('BackgroundWork', (live) => {
  live.effect('follows the end of a background shell output until it ends', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const { file, outputFile } = yield* scratch()
      const snapshots = yield* watching(file)
      const first = yield* Queue.take(snapshots)

      yield* fileSystem.writeFileString(
        outputFile,
        `$ vite\nready in 412 ms\nbuilding 10%\rbuilt\n${ESCAPE}[32m➜${ESCAPE}[0m Local: http://localhost:5173/\n`,
      )
      const second = yield* Queue.take(snapshots)

      yield* fileSystem.writeFileString(file.path, noticeLine, { flag: 'a' })
      const third = yield* Queue.take(snapshots)

      expect(shellOf(first)).toEqual([{ status: 'running', output: ['$ vite', 'ready in 412 ms'] }])
      expect(shellOf(second)).toEqual([
        {
          status: 'running',
          output: ['ready in 412 ms', 'built', '➜ Local: http://localhost:5173/'],
        },
      ])
      expect(shellOf(third)).toEqual([
        {
          status: 'stopped',
          output: ['ready in 412 ms', 'built', '➜ Local: http://localhost:5173/'],
        },
      ])
      expect(Option.isSome(first.tasks[0]?.startedAt ?? Option.none())).toBe(true)
    }),
  )

  live.effect('says what each running subagent is doing from its own transcript', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const { file, subagents } = yield* scratch()
      const agentFile = `${subagents}/agent-${SUBAGENT}.jsonl`

      yield* fileSystem.makeDirectory(subagents, { recursive: true })
      yield* fileSystem.writeFileString(
        `${subagents}/agent-${SUBAGENT}.meta.json`,
        encodeJson({ agentType: 'Explore', description: 'Trace the swap', spawnDepth: 1 }),
      )
      yield* fileSystem.writeFileString(
        agentFile,
        subagentStep('2026-10-30T14:22:05.000Z', {
          type: 'tool_use',
          id: 'toolu_read',
          name: 'Read',
          input: { file_path: '/repo/src/chat/Thread.tsx' },
        }),
      )
      const snapshots = yield* watching(file)
      const first = yield* takeWhere(snapshots, (snapshot) => snapshot.activity.length > 0)

      yield* Effect.sleep(WATCHERS_SETTLED)
      yield* fileSystem.writeFileString(
        agentFile,
        subagentStep('2026-10-30T14:22:41.000Z', {
          type: 'text',
          text: 'Writing up findings\nThe swap replaces the view in one commit.',
        }),
        { flag: 'a' },
      )
      const second = yield* takeWhere(snapshots, (snapshot) =>
        snapshot.activity.some((step) => Option.isSome(step.text)),
      )

      expect(first.activity.map((step) => [step.tool, step.subject, step.text])).toEqual([
        [Option.some('Read'), Option.some('/repo/src/chat/Thread.tsx'), Option.none()],
      ])
      expect(second.activity.map((step) => [step.tool, step.text])).toEqual([
        [Option.none(), Option.some('Writing up findings')],
      ])
    }),
  )
})

describe('outputLines', () => {
  it('keeps a line that ends in a carriage return and the last redraw of one that does not', () => {
    const bytes = new TextEncoder().encode('built in 2s\r\n10%\r50%\r100%\n')

    expect(
      outputLines({ bytes, fromStart: true, modifiedAt: Option.none(), size: bytes.byteLength }),
    ).toEqual(['built in 2s', '100%'])
  })
})
