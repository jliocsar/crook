import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { type RunningCounts, RunningSubagents } from '@crook/agent/RunningSubagents'
import { ClaudeSessionId } from '@crook/domain/Ids'

const SESSION = ClaudeSessionId.make('ff0f77be-1e98-4bb2-8b24-38d673361867')
const PROJECT = '-home-jliocsar-Projects-crook'
const SLEEP_META = 'agent-aa5c894dc268d33c7.meta.json'
const SLEEP_TOOL_USE = 'toolu_01ChD5J64zNtNw3N4bkav5Fx'

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const fixturePath = new URL(
  import.meta.resolve(`@crook/claude/fixtures/subagent/${SESSION}/subagents/${SLEEP_META}`),
).pathname

const noticeLine = `${encodeJson({
  type: 'attachment',
  uuid: 'e193f484-3ab2-4f97-bfb0-1c6e19889174',
  timestamp: '2026-10-16T16:25:05.395Z',
  attachment: {
    type: 'queued_command',
    prompt: `<task-notification>\n<task-id>aa5c894dc268d33c7</task-id>\n<tool-use-id>${SLEEP_TOOL_USE}</tool-use-id>\n<status>completed</status>\n</task-notification>`,
    commandMode: 'task-notification',
    origin: { kind: 'task-notification' },
  },
})}\n`

const sessionWithRunningSubagent = Effect.fn('sessionWithRunningSubagent')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const root = yield* fileSystem.makeTempDirectoryScoped()
  const project = `${root}/projects/${PROJECT}`
  const subagents = `${project}/${SESSION}/subagents`
  const meta = yield* fileSystem.readFileString(fixturePath)

  yield* fileSystem.makeDirectory(subagents, { recursive: true })
  yield* fileSystem.writeFileString(`${project}/${SESSION}.jsonl`, '')
  yield* fileSystem.writeFileString(
    `${subagents}/${SLEEP_META}`,
    meta.replace('"finished": true', '"finished": false'),
  )

  return { root, transcript: `${project}/${SESSION}.jsonl` }
})

const countsWhere = (
  running: RunningSubagents['Service'],
  predicate: (counts: RunningCounts) => boolean,
) =>
  running.changes.pipe(Stream.filter(predicate), Stream.runHead, Effect.flatMap(Effect.fromOption))

layer(Layer.mergeAll(BunFileSystem.layer, Path.layer), { excludeTestServices: true })(
  'RunningSubagents',
  (live) => {
    live.effect('counts the running subagents of a followed session until a notice ends them', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const { root, transcript } = yield* sessionWithRunningSubagent()
        const context = yield* Layer.build(RunningSubagents.layerAt([root]))
        const running = Context.get(context, RunningSubagents)

        yield* running.follow(HashSet.make(SESSION))
        const started = yield* countsWhere(running, HashMap.has(SESSION))
        yield* fileSystem.writeFileString(transcript, noticeLine, { flag: 'a' })
        const ended = yield* countsWhere(running, (counts) =>
          Option.contains(HashMap.get(counts, SESSION), 0),
        )
        yield* running.follow(HashSet.empty())
        const dropped = yield* countsWhere(running, (counts) => !HashMap.has(counts, SESSION))

        expect(HashMap.get(started, SESSION)).toEqual(Option.some(1))
        expect(HashMap.get(ended, SESSION)).toEqual(Option.some(0))
        expect(HashMap.size(dropped)).toBe(0)
      }),
    )
  },
)
