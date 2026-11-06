import { describe, expect, it, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import {
  EMPTY_LEDGER,
  backgroundLines,
  backgroundTasks,
  outputFileOf,
  withBackgroundLines,
} from '@crook/claude/BackgroundTasks'
import type { BackgroundTask } from '@crook/domain/Background'
import { TranscriptOffset } from '@crook/domain/Ids'

import { START, fixtureFile, readToEnd, services } from './Fixtures'

const ledgerOf = (name: string) =>
  readToEnd(fixtureFile(name), START, backgroundLines).pipe(
    Stream.runFold(
      () => EMPTY_LEDGER,
      (ledger, chunk) => withBackgroundLines(ledger, chunk.messages),
    ),
  )

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const encoder = new TextEncoder()

const ledgerFromLines = (lines: readonly Schema.Json[]) =>
  Arr.reduce(lines, EMPTY_LEDGER, (ledger, json) =>
    withBackgroundLines(
      ledger,
      backgroundLines(encoder.encode(encodeJson(json)), TranscriptOffset.make(0)),
    ),
  )

const assistantUse = (id: string, name: string, input: Schema.Json) => ({
  type: 'assistant',
  uuid: `assistant-${id}`,
  timestamp: '2026-10-30T14:00:00.000Z',
  message: { id: `msg-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
})

const userResult = (id: string, text: string, isError = false) => ({
  type: 'user',
  uuid: `user-${id}`,
  timestamp: '2026-10-30T14:00:01.000Z',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content: text, is_error: isError }],
  },
})

const withToolUseResult = (line: ReturnType<typeof userResult>, toolUseResult: Schema.Json) => ({
  ...line,
  toolUseResult,
})

const devServerLines = [
  assistantUse('toolu_dev', 'Bash', { command: 'bun run dev', run_in_background: true }),
  withToolUseResult(
    userResult(
      'toolu_dev',
      'Command running in background with ID: bdev. Output is being written to: /x/tasks/bdev.output',
    ),
    { backgroundTaskId: 'bdev' },
  ),
]

const statusesOf = (lines: readonly Schema.Json[]) =>
  Arr.map(backgroundTasks(ledgerFromLines(lines)), (task) => [task.taskId, task.status])

const at = (iso: string) => Option.some(DateTime.makeUnsafe(iso))

const shape = (task: BackgroundTask) =>
  Match.value(task).pipe(
    Match.tagsExhaustive({
      ShellTask: (shell) => ({
        kind: 'shell',
        taskId: shell.taskId,
        label: Option.getOrUndefined(shell.description),
        status: shell.status,
        stoppedByClaude: shell.stoppedByClaude,
      }),
      MonitorTask: (monitor) => ({
        kind: 'monitor',
        taskId: monitor.taskId,
        label: monitor.description,
        status: monitor.status,
        stoppedByClaude: monitor.stoppedByClaude,
      }),
    }),
  )

layer(services, { excludeTestServices: true })('BackgroundTasks', (live) => {
  live.effect('pairs every background shell with how it ended', () =>
    Effect.gen(function* () {
      const tasks = backgroundTasks(yield* ledgerOf('background/shells.jsonl'))

      expect(Arr.map(tasks, shape)).toEqual([
        {
          kind: 'shell',
          taskId: 'bvpsj5i7o',
          label: 'Run pie serve on the tailscale IP in the background',
          status: 'failed',
          stoppedByClaude: false,
        },
        {
          kind: 'shell',
          taskId: 'bl2dlx3wl',
          label: 'Run the setup line inside the container',
          status: 'completed',
          stoppedByClaude: false,
        },
        {
          kind: 'shell',
          taskId: 'b3kkztkdt',
          label: 'Serve the rebuilt pie on the tailnet IP',
          status: 'stopped',
          stoppedByClaude: false,
        },
        {
          kind: 'shell',
          taskId: 'bua6a4i2e',
          label: 'Serve the released pie on the tailnet IP',
          status: 'stopped',
          stoppedByClaude: false,
        },
        {
          kind: 'shell',
          taskId: 'b0t1sh0l4',
          label: 'Open the plan draft in plannotator for annotation',
          status: 'completed',
          stoppedByClaude: false,
        },
        {
          kind: 'shell',
          taskId: 'bkkyn31oj',
          label: "See git's output for an unreachable repo and find clone sites",
          status: 'stopped',
          stoppedByClaude: true,
        },
      ])
    }),
  )

  live.effect('keeps the command, the times and the summary of a failed shell', () =>
    Effect.gen(function* () {
      const ledger = yield* ledgerOf('background/shells.jsonl')
      const failed = pipe(backgroundTasks(ledger), Arr.head, Option.getOrThrow)

      expect(failed).toMatchObject({
        toolUseId: 'toolu_01Y2hHo9gxkBYRmBmzbGi1zU',
        startedAt: at('2026-09-27T18:47:07.807Z'),
        endedAt: at('2026-09-27T18:49:20.832Z'),
        summary: Option.some(
          'Background command "Run pie serve on the tailscale IP in the background" failed with exit code 130',
        ),
      })
      expect(Option.getOrThrow(outputFileOf(ledger, 'bvpsj5i7o'))).toBe(
        '/tmp/claude-1000/-home-jliocsar-Projects-agents-machines/85aeca1a-76c2-4699-b51c-26112db59f20/tasks/bvpsj5i7o.output',
      )
    }),
  )

  live.effect('counts a Read of the output file as Claude checking on the shell', () =>
    Effect.gen(function* () {
      const tasks = backgroundTasks(yield* ledgerOf('background/shells.jsonl'))

      expect(
        Arr.findFirst(tasks, (task) => task.taskId === 'b0t1sh0l4').pipe(
          Option.flatMap((task) =>
            Match.value(task).pipe(
              Match.tag('ShellTask', (shell) => Option.some(shell.checkedAt)),
              Match.orElse(() => Option.none()),
            ),
          ),
        ),
      ).toEqual(Option.some([DateTime.makeUnsafe('2026-09-29T18:14:12.616Z')]))
    }),
  )

  live.effect(
    'pairs a shell started from a plugin by its result, and a Monitor with its events',
    () =>
      Effect.gen(function* () {
        const tasks = backgroundTasks(yield* ledgerOf('background/plugin-shell-and-monitor.jsonl'))

        expect(Arr.map(tasks, shape)).toEqual([
          {
            kind: 'shell',
            taskId: 'br7ab8giw',
            label: 'liveness probe ticker',
            status: 'completed',
            stoppedByClaude: false,
          },
          {
            kind: 'monitor',
            taskId: 'bii0b1qsm',
            label: 'jc137 liveness probe events',
            status: 'completed',
            stoppedByClaude: false,
          },
        ])
        expect(tasks[1]).toMatchObject({
          command: Option.some('for i in 1 2 3; do echo "probe event $i"; sleep 4; done'),
          startedAt: at('2026-10-30T22:26:06.104Z'),
          expiresAt: at('2026-10-30T22:27:06.555Z'),
          events: [
            { at: at('2026-10-30T22:26:06.803Z'), text: 'probe event 1' },
            { at: at('2026-10-30T22:26:10.787Z'), text: 'probe event 2' },
            { at: at('2026-10-30T22:26:14.792Z'), text: 'probe event 3' },
          ],
        })
      }),
  )
})

describe('backgroundLines', () => {
  it('skips lines that cannot be about background work without parsing them', () => {
    expect(
      backgroundLines(
        new TextEncoder().encode('{"type":"assistant","message":{"content":[]}}'),
        START,
      ),
    ).toEqual([])
  })
})

describe('background lines that are not background work', () => {
  it('ignores a file Claude read that quotes a background launch', () => {
    const ledger = ledgerFromLines([
      assistantUse('toolu_read', 'Read', { file_path: '/home/crook/transcript.jsonl' }),
      userResult(
        'toolu_read',
        '1\t{"content":"Command running in background with ID: bquoted. Output is being written to: /x/tasks/bquoted.output"}',
      ),
    ])

    expect(backgroundTasks(ledger)).toEqual([])
  })

  it('ignores another tool whose result names a task id', () => {
    expect(
      statusesOf([
        assistantUse('toolu_update', 'TaskUpdate', { taskId: '3', status: 'completed' }),
        withToolUseResult(
          userResult('toolu_update', 'Updated task #3: tail /x/tasks/bdev.output'),
          { success: true, taskId: '3', updatedFields: ['status'] },
        ),
      ]),
    ).toEqual([])
  })

  it('stops a shell only once its TaskStop succeeded', () => {
    const stop = assistantUse('toolu_stop', 'TaskStop', { task_id: 'bdev' })

    expect(
      statusesOf([
        ...devServerLines,
        stop,
        userResult('toolu_stop', '[Request interrupted by user for tool use]', true),
      ]),
    ).toEqual([['bdev', 'running']])
    expect(
      statusesOf([
        ...devServerLines,
        stop,
        userResult('toolu_stop', '{"message":"Successfully stopped task: bdev (bun run dev)"}'),
      ]),
    ).toEqual([['bdev', 'stopped']])
  })

  it('ignores a TaskStop of a task it never saw start', () => {
    const ledger = ledgerFromLines([
      assistantUse('toolu_stop', 'TaskStop', { task_id: 'bunknown' }),
    ])

    expect(backgroundTasks(ledger)).toEqual([])
  })
})
