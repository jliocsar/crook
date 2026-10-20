import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { expect, layer } from '@effect/vitest'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

import {
  TranscriptFile,
  TranscriptLocator,
  TranscriptSessionInvalid,
  subagentFileOf,
  subagentsDirectoryOf,
} from '@crook/claude/TranscriptLocator'
import { ClaudeSessionId, SubagentId } from '@crook/domain/Ids'

import { SESSION, WATCHERS_SETTLED } from './Fixtures'

const OTHER_SESSION = ClaudeSessionId.make('ff0f77be-1e98-4bb2-8b24-38d673361867')
const PROJECT = '-home-dev-Projects-crook'
const LINE = '{"type":"mode"}\n'

const roots = Effect.fn('roots')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const home = yield* fileSystem.makeTempDirectoryScoped()

  return { home, claude: `${home}/.claude`, work: `${home}/.claude-work` }
})

const writeSession = Effect.fn('writeSession')(function* (
  root: string,
  project: string,
  session: ClaudeSessionId,
) {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = `${root}/projects/${project}`

  yield* fileSystem.makeDirectory(directory, { recursive: true })
  yield* fileSystem.writeFileString(`${directory}/${session}.jsonl`, LINE)

  return new TranscriptFile({ session, path: `${directory}/${session}.jsonl` })
})

const locatorAt = Effect.fn('locatorAt')(function* (paths: readonly string[]) {
  const context = yield* Layer.build(TranscriptLocator.layerAt(paths))

  return Context.get(context, TranscriptLocator)
})

layer(BunFileSystem.layer, { excludeTestServices: true })('TranscriptLocator', (live) => {
  live.effect('finds a session under any configured root, never from the cwd', () =>
    Effect.gen(function* () {
      const { claude, work } = yield* roots()
      const expected = yield* writeSession(work, '-home-dev-elsewhere', SESSION)

      yield* writeSession(claude, PROJECT, OTHER_SESSION)
      const locator = yield* locatorAt([claude, work])

      expect(yield* locator.locate(SESSION)).toEqual(Option.some(expected))
    }),
  )

  live.effect('has nothing for a session without a file, and refuses ids that are not ids', () =>
    Effect.gen(function* () {
      const { claude, work } = yield* roots()
      const locator = yield* locatorAt([claude, work])
      const traversal = ClaudeSessionId.make('../../etc/passwd')

      expect(yield* locator.locate(SESSION)).toEqual(Option.none())
      expect(yield* locator.locate(traversal).pipe(Effect.flip)).toEqual(
        new TranscriptSessionInvalid({ session: traversal }),
      )
    }),
  )

  live.effect(
    'waits for the first prompt to create the file, in a project folder that exists',
    () =>
      Effect.gen(function* () {
        const { claude } = yield* roots()

        yield* writeSession(claude, PROJECT, OTHER_SESSION)
        const locator = yield* locatorAt([claude])
        const waiting = yield* Effect.forkScoped(locator.await(SESSION))

        yield* Effect.sleep(WATCHERS_SETTLED)
        const created = yield* writeSession(claude, PROJECT, SESSION)

        expect(yield* Fiber.join(waiting)).toEqual(created)
      }),
  )

  live.effect('waits through a root that does not exist yet and a new project folder', () =>
    Effect.gen(function* () {
      const { work } = yield* roots()
      const locator = yield* locatorAt([work])
      const waiting = yield* Effect.forkScoped(locator.await(SESSION))

      yield* Effect.sleep(WATCHERS_SETTLED)
      const created = yield* writeSession(work, PROJECT, SESSION)

      expect(yield* Fiber.join(waiting)).toEqual(created)
    }),
  )

  live.effect('places subagent transcripts in the session folder', () =>
    Effect.gen(function* () {
      const file = new TranscriptFile({
        session: SESSION,
        path: `/home/dev/.claude/projects/${PROJECT}/${SESSION}.jsonl`,
      })

      expect(subagentsDirectoryOf(file)).toBe(
        `/home/dev/.claude/projects/${PROJECT}/${SESSION}/subagents`,
      )
      expect(subagentFileOf(file, SubagentId.make('a370777a87a436836'))).toEqual(
        new TranscriptFile({
          session: SESSION,
          path: `/home/dev/.claude/projects/${PROJECT}/${SESSION}/subagents/agent-a370777a87a436836.jsonl`,
        }),
      )
    }),
  )
})
