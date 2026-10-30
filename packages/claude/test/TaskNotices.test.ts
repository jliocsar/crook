import { describe, expect, it, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'

import { SubagentRoster, subagentFromMeta } from '@crook/claude/SubagentRoster'
import {
  NO_TASK_NOTICES,
  settledSubagent,
  taskNoticeLines,
  withTaskNotices,
} from '@crook/claude/TaskNotices'
import { TranscriptFile, subagentsDirectoryOf } from '@crook/claude/TranscriptLocator'
import { ClaudeSessionId, SubagentId, TranscriptOffset } from '@crook/domain/Ids'
import { Subagent, type SubagentStatus } from '@crook/domain/Subagent'
import { TaskNotificationBlock, UserMessage } from '@crook/domain/TranscriptMessage'

import { FIXTURES, services } from './Fixtures'

const STUCK_RUNS = `${FIXTURES}/stuck-runs`
const STUCK_RUN_COUNT = 14
const TOOL_USE = 'toolu_01TEtTJbTWm42en6AZWUKeaZ'
const LINE = TranscriptOffset.make(0)

const encoder = new TextEncoder()

const running = new Subagent({
  id: SubagentId.make('a19676da0e503de60'),
  agentType: 'general-purpose',
  description: 'bump effect in boilerplate',
  model: Option.none(),
  toolUseId: Option.some(TOOL_USE),
  parent: Option.none(),
  spawnDepth: 1,
  background: true,
  status: 'running',
})

const noticeFor = (toolUseId: string, status: string) =>
  new UserMessage({
    offset: LINE,
    uuid: Option.none(),
    timestamp: Option.none(),
    isMeta: false,
    origin: Option.some('task-notification'),
    queued: true,
    blocks: [
      new TaskNotificationBlock({
        taskId: 'a19676da0e503de60',
        toolUseId: Option.some(toolUseId),
        status: Option.some(status),
        summary: Option.none(),
        result: Option.none(),
      }),
    ],
  })

const settledWith = (subagent: Subagent, status: string, toolUseId = TOOL_USE) =>
  settledSubagent(withTaskNotices(NO_TASK_NOTICES, [noticeFor(toolUseId, status)]))(subagent).status

const stuckSessions = Effect.fn('stuckSessions')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const names = yield* fileSystem.readDirectory(STUCK_RUNS)

  return pipe(
    names,
    Arr.filter((name) => name.endsWith('.jsonl')),
    Arr.map(
      (name) =>
        new TranscriptFile({
          session: ClaudeSessionId.make(name.slice(0, -'.jsonl'.length)),
          path: `${STUCK_RUNS}/${name}`,
        }),
    ),
  )
})

const metaStatuses = Effect.fn('metaStatuses')(function* (file: TranscriptFile) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = subagentsDirectoryOf(path, file)
  const names = yield* fileSystem.readDirectory(directory)

  return yield* Effect.forEach(names, (name) =>
    Effect.map(fileSystem.readFileString(`${directory}/${name}`), (content) =>
      Option.map(
        subagentFromMeta(
          SubagentId.make(name.slice('agent-'.length, -'.meta.json'.length)),
          content,
        ),
        (subagent) => subagent.status,
      ),
    ),
  )
})

describe('settledSubagent', () => {
  it('takes the outcome of the notification for the run over what its meta says', () => {
    const outcomes: readonly (readonly [string, SubagentStatus])[] = [
      ['completed', 'completed'],
      ['failed', 'failed'],
      ['killed', 'stopped'],
      ['stopped', 'stopped'],
    ]

    expect(Arr.map(outcomes, ([status]) => settledWith(running, status))).toEqual(
      Arr.map(outcomes, ([, outcome]) => outcome),
    )
  })

  it('leaves a run alone when no notification names it', () => {
    expect(settledWith(running, 'completed', 'toolu_someone_else')).toBe('running')
    expect(settledSubagent(NO_TASK_NOTICES)(running)).toBe(running)
  })
})

describe('taskNoticeLines', () => {
  it('parses only the lines that carry a task notification', () => {
    const prompt = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'hi' },
    })

    expect(taskNoticeLines(encoder.encode(prompt), LINE)).toEqual([])
  })
})

layer(services, { excludeTestServices: true })('the stuck runs captured on the laptop', (live) => {
  live.effect(
    'read as running from their meta alone, and as completed once their notification is read',
    () =>
      Effect.gen(function* () {
        const roster = yield* SubagentRoster
        const sessions = yield* stuckSessions()
        const fromMetas = yield* Effect.forEach(sessions, metaStatuses)
        const settled = yield* Effect.forEach(sessions, (file) => roster.read(file))

        expect(Arr.getSomes(fromMetas.flat())).toEqual(
          Arr.makeBy(STUCK_RUN_COUNT, (): SubagentStatus => 'running'),
        )
        expect(settled.flat().map((subagent) => subagent.status)).toEqual(
          Arr.makeBy(STUCK_RUN_COUNT, (): SubagentStatus => 'completed'),
        )
      }),
  )
})
