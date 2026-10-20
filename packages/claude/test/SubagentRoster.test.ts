import { expect, layer } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Stream from 'effect/Stream'

import { SubagentRoster, subagentFromMeta } from '@crook/claude/SubagentRoster'
import { TranscriptFile, subagentsDirectoryOf } from '@crook/claude/TranscriptLocator'
import { ClaudeSessionId, SubagentId } from '@crook/domain/Ids'
import { Subagent, isRunning, runningCount } from '@crook/domain/Subagent'

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

const readAgent = new Subagent({
  id: READ_AGENT,
  agentType: 'general-purpose',
  description: 'Read hello.txt',
  model: Option.none(),
  toolUseId: Option.some('toolu_01W5pW7EVJbSou9dL9TCPQPx'),
  parent: Option.none(),
  spawnDepth: 1,
  background: true,
  finished: true,
  stoppedByUser: false,
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
  const name = `agent-${agent}.meta.json`

  yield* fileSystem.copyFile(`${SUBAGENTS}/${name}`, `${subagentsDirectoryOf(file)}/${name}`)
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
        Option.map(nested, (subagent) => [
          subagent.parent,
          subagent.spawnDepth,
          isRunning(subagent),
        ]),
      ).toEqual(Option.some([Option.some(SubagentId.make('a1764732aa4808ef6')), 2, true]))
      expect(subagentFromMeta(READ_AGENT, '{"description":"no type"}')).toEqual(Option.none())
    }),
  )

  live.effect('waits for the subagents folder, then follows each new or rewritten meta', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const file = yield* scratchSession()
      const updates = yield* watching(file)

      yield* Effect.sleep(WATCHERS_SETTLED)
      yield* fileSystem.makeDirectory(subagentsDirectoryOf(file), { recursive: true })
      yield* copyMeta(file, READ_AGENT)
      const first = yield* Queue.take(updates)
      const running = yield* fixtureText(
        `subagent/${SUBAGENT_FIXTURE_SESSION}/subagents/agent-${SLEEP_AGENT}.meta.json`,
      )
      const temporary = `${subagentsDirectoryOf(file)}/agent-${SLEEP_AGENT}.meta.json.tmp.0a1b2c3d`

      yield* fileSystem.writeFileString(
        temporary,
        running.replace('"finished": true', '"finished": false'),
      )
      yield* fileSystem.rename(
        temporary,
        `${subagentsDirectoryOf(file)}/agent-${SLEEP_AGENT}.meta.json`,
      )
      const second = yield* Queue.take(updates)

      expect(first).toEqual([readAgent])
      expect(second.map((subagent) => subagent.id)).toEqual([READ_AGENT, SLEEP_AGENT])
      expect(runningCount(second)).toBe(1)
    }),
  )
})
