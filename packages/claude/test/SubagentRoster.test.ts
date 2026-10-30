import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Schema from 'effect/Schema'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

import { SubagentRoster, subagentFromMeta } from '@crook/claude/SubagentRoster'
import { TranscriptFile, subagentsDirectoryOf } from '@crook/claude/TranscriptLocator'
import { ClaudeSessionId, SubagentId } from '@crook/domain/Ids'
import { Subagent } from '@crook/domain/Subagent'

import {
  FIXTURES,
  SUBAGENT_FIXTURE_SESSION,
  WATCHERS_SETTLED,
  fixtureText,
  services,
} from './Fixtures'

const SESSION = ClaudeSessionId.make(SUBAGENT_FIXTURE_SESSION)
const READ_AGENT = SubagentId.make('a370777a87a436836')
const SLEEP_AGENT = SubagentId.make('aa5c894dc268d33c7')
const SUBAGENTS = `${FIXTURES}/subagent/${SUBAGENT_FIXTURE_SESSION}/subagents`
const SLEEP_TOOL_USE = 'toolu_01ChD5J64zNtNw3N4bkav5Fx'

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json))

const noticeLine = (toolUseId: string) =>
  `${encodeJson({
    type: 'attachment',
    uuid: 'e193f484-3ab2-4f97-bfb0-1c6e19889174',
    timestamp: '2026-10-16T16:25:05.395Z',
    attachment: {
      type: 'queued_command',
      prompt: `<task-notification>\n<task-id>${SLEEP_AGENT}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>completed</status>\n</task-notification>`,
      commandMode: 'task-notification',
      origin: { kind: 'task-notification' },
    },
  })}\n`

const readAgent = new Subagent({
  id: READ_AGENT,
  agentType: 'general-purpose',
  description: 'Read hello.txt',
  model: Option.none(),
  toolUseId: Option.some('toolu_01W5pW7EVJbSou9dL9TCPQPx'),
  parent: Option.none(),
  spawnDepth: 1,
  background: true,
  status: 'completed',
})

const scratchSession = Effect.fn('scratchSession')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped()
  const path = `${directory}/${SESSION}.jsonl`

  yield* fileSystem.writeFileString(path, '')

  return new TranscriptFile({ session: SESSION, path })
})

const watching = Effect.fn('watching')(function* (file: TranscriptFile) {
  const roster = yield* SubagentRoster
  const updates = yield* Queue.unbounded<readonly Subagent[]>()

  yield* roster.watch(file).pipe(
    Stream.runForEach((subagents) => Queue.offer(updates, subagents)),
    Effect.forkScoped,
  )

  return updates
})

const copyMeta = Effect.fn('copyMeta')(function* (file: TranscriptFile, agent: SubagentId) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const name = `agent-${agent}.meta.json`

  yield* fileSystem.copyFile(
    `${SUBAGENTS}/${name}`,
    path.join(subagentsDirectoryOf(path, file), name),
  )
})

layer(services, { excludeTestServices: true })('SubagentRoster', (live) => {
  live.effect('reads the type, description, link and state from each meta file', () =>
    Effect.gen(function* () {
      const nested = subagentFromMeta(
        SubagentId.make('a0f3d2c1b4e5f6a7b'),
        yield* fixtureText('subagent-nested.meta.json'),
      )

      expect(
        subagentFromMeta(
          READ_AGENT,
          yield* fixtureText(
            `subagent/${SUBAGENT_FIXTURE_SESSION}/subagents/agent-${READ_AGENT}.meta.json`,
          ),
        ),
      ).toEqual(Option.some(readAgent))
      expect(
        Option.map(nested, (subagent) => [subagent.parent, subagent.spawnDepth, subagent.status]),
      ).toEqual(Option.some([Option.some(SubagentId.make('a1764732aa4808ef6')), 2, 'running']))
      expect(subagentFromMeta(READ_AGENT, '{"description":"no type"}')).toEqual(Option.none())
      expect(subagentFromMeta(READ_AGENT, '{"agentType":"Explore"}')).toEqual(Option.none())
    }),
  )

  live.effect('waits for the subagents folder, then follows each new or rewritten meta', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const file = yield* scratchSession()
      const directory = subagentsDirectoryOf(path, file)
      const updates = yield* watching(file)

      yield* Effect.sleep(WATCHERS_SETTLED)
      yield* fileSystem.makeDirectory(directory, { recursive: true })
      yield* copyMeta(file, READ_AGENT)
      const first = yield* Queue.take(updates)
      const running = yield* fixtureText(
        `subagent/${SUBAGENT_FIXTURE_SESSION}/subagents/agent-${SLEEP_AGENT}.meta.json`,
      )
      const temporary = `${directory}/agent-${SLEEP_AGENT}.meta.json.tmp.0a1b2c3d`

      yield* fileSystem.writeFileString(
        temporary,
        running.replace('"finished": true', '"finished": false'),
      )
      yield* fileSystem.rename(temporary, `${directory}/agent-${SLEEP_AGENT}.meta.json`)
      const second = yield* Queue.take(updates)

      expect(first).toEqual([readAgent])
      expect(second.map((subagent) => subagent.id)).toEqual([READ_AGENT, SLEEP_AGENT])
      expect(second.map((subagent) => subagent.status)).toEqual(['completed', 'running'])
    }),
  )

  live.effect('starts from the notifications already in the transcript, never from none', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const file = yield* scratchSession()
      const directory = subagentsDirectoryOf(path, file)
      const meta = yield* fixtureText(
        `subagent/${SUBAGENT_FIXTURE_SESSION}/subagents/agent-${SLEEP_AGENT}.meta.json`,
      )

      yield* fileSystem.writeFileString(file.path, noticeLine(SLEEP_TOOL_USE))
      yield* fileSystem.makeDirectory(directory, { recursive: true })
      yield* fileSystem.writeFileString(
        `${directory}/agent-${SLEEP_AGENT}.meta.json`,
        meta.replace('"finished": true', '"finished": false'),
      )
      const updates = yield* watching(file)
      const first = yield* Queue.take(updates)

      expect(first.map((subagent) => subagent.status)).toEqual(['completed'])
    }),
  )

  live.effect('settles a running subagent once a notification for it lands in the transcript', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const file = yield* scratchSession()
      const directory = subagentsDirectoryOf(path, file)
      const meta = yield* fixtureText(
        `subagent/${SUBAGENT_FIXTURE_SESSION}/subagents/agent-${SLEEP_AGENT}.meta.json`,
      )

      yield* fileSystem.makeDirectory(directory, { recursive: true })
      yield* fileSystem.writeFileString(
        `${directory}/agent-${SLEEP_AGENT}.meta.json`,
        meta.replace('"finished": true', '"finished": false'),
      )
      const updates = yield* watching(file)
      const first = yield* Queue.take(updates)

      yield* fileSystem.writeFileString(file.path, noticeLine(SLEEP_TOOL_USE), { flag: 'a' })
      const second = yield* Queue.take(updates)

      expect(first.map((subagent) => subagent.status)).toEqual(['running'])
      expect(second.map((subagent) => subagent.status)).toEqual(['completed'])
    }),
  )
})
