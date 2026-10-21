import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import * as BunPath from '@effect/platform-bun/BunPath'
import { expect, layer } from '@effect/vitest'
import * as ConfigProvider from 'effect/ConfigProvider'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'

import { CreatedPanes, CrookCreatedPanesPath } from '@crook/agent/CreatedPanes'
import { PaneId } from '@crook/domain/Ids'

const PANE = PaneId.make('w1:p1')
const OTHER_PANE = PaneId.make('w1:p2')

const StoredPanes = Schema.fromJsonString(Schema.Array(Schema.String))

const createdPanesAt = Effect.fn('createdPanesAt')(function* (file: string) {
  const context = yield* Layer.build(
    CreatedPanes.layer.pipe(
      Layer.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ CROOK_CREATED_PANES_PATH: file })),
      ),
    ),
  )

  return Context.get(context, CreatedPanes)
})

const scratchFile = Effect.fn('scratchFile')(function* (name: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const directory = yield* fileSystem.makeTempDirectoryScoped()

  return `${directory}/state/crook/${name}`
})

layer(Layer.mergeAll(BunFileSystem.layer, BunPath.layer), { excludeTestServices: true })(
  'CreatedPanes',
  (it) => {
    it.effect('remembers the panes crook created across a restart, and forgets closed ones', () =>
      Effect.gen(function* () {
        const file = yield* scratchFile('created-panes.json')
        const first = yield* createdPanesAt(file)

        yield* first.remember(PANE)
        yield* first.remember(OTHER_PANE)
        yield* first.forget(OTHER_PANE)
        const restarted = yield* createdPanesAt(file)
        const stored = yield* (yield* FileSystem.FileSystem)
          .readFileString(file)
          .pipe(Effect.flatMap(Schema.decodeEffect(StoredPanes)))

        expect(yield* restarted.has(PANE)).toBe(true)
        expect(yield* restarted.has(OTHER_PANE)).toBe(false)
        expect(stored).toEqual(['w1:p1'])
      }),
    )

    it.effect('starts with no panes when the file is missing or unreadable', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const missing = yield* createdPanesAt(yield* scratchFile('created-panes.json'))
        const corrupt = yield* scratchFile('created-panes.json')

        yield* fileSystem.makeDirectory(corrupt.slice(0, corrupt.lastIndexOf('/')), {
          recursive: true,
        })
        yield* fileSystem.writeFileString(corrupt, '{"panes":')
        const unreadable = yield* createdPanesAt(corrupt)

        expect(yield* missing.has(PANE)).toBe(false)
        expect(yield* unreadable.has(PANE)).toBe(false)
      }),
    )

    it.effect('moves an unreadable record aside before the next change writes a new one', () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const file = yield* scratchFile('created-panes.json')

        yield* fileSystem.makeDirectory(file.slice(0, file.lastIndexOf('/')), { recursive: true })
        yield* fileSystem.writeFileString(file, '{"panes":')
        const unreadable = yield* createdPanesAt(file)

        yield* unreadable.remember(PANE)
        const setAside = yield* fileSystem.readFileString(`${file}.unreadable`)
        const stored = yield* fileSystem
          .readFileString(file)
          .pipe(Effect.flatMap(Schema.decodeEffect(StoredPanes)))

        expect(setAside).toBe('{"panes":')
        expect(stored).toEqual(['w1:p1'])
      }),
    )

    it.effect('keeps its record under the XDG state directory unless told otherwise', () =>
      Effect.gen(function* () {
        const fromStateHome = yield* CrookCreatedPanesPath.parse(
          ConfigProvider.fromUnknown({ XDG_STATE_HOME: '/state', HOME: '/home/jc' }),
        )
        const fromHome = yield* CrookCreatedPanesPath.parse(
          ConfigProvider.fromUnknown({ HOME: '/home/jc' }),
        )

        expect(fromStateHome).toBe('/state/crook/created-panes.json')
        expect(fromHome).toBe('/home/jc/.local/state/crook/created-panes.json')
      }),
    )
  },
)
