import * as BunFileSystem from '@effect/platform-bun/BunFileSystem'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { expect, layer } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import type { PlatformError } from 'effect/PlatformError'

const WEB_ROOT = new URL('../..', import.meta.url).pathname
const SRC = `${WEB_ROOT}src`
const STORIES = `${WEB_ROOT}stories`
const TEST = `${WEB_ROOT}test`
const OWN_PREFIX = '@crook/web/'
const STORY_ONLY_COLOUR = 'c0ffee'
const KITCHEN_ONLY_COLOUR = 'facade'
const SOURCE_EXTENSIONS: readonly string[] = ['', '.ts', '.tsx', '/index.ts', '/index.tsx']
const IMPORT_PATTERN = /(?:from\s+|import\s*\(\s*|import\s+|new\s+URL\(\s*)['"]([^'"]+)['"]/gu
const HTML_SCRIPT_PATTERN = /<script[^>]+src="([^"]+)"/gu
const KITCHEN_PROBE_FOLDER = `${STORIES}/kitchen/css-probe`
const KITCHEN_PROBE_CLASS = `outline-[#${KITCHEN_ONLY_COLOUR}]`

const resolvedFrom = (from: string, relative: string): string =>
  new URL(relative, `file://${from}`).pathname

const directoryOf = (file: string): string => resolvedFrom(file, '.').replace(/\/$/u, '')

const specifiersOf = (text: string): readonly string[] =>
  Array.from(text.matchAll(IMPORT_PATTERN), (found) => found[1] ?? '')

const candidatesOf = (specifier: string, from: string): readonly string[] => {
  const bare = specifier.split('?')[0] ?? specifier

  if (bare.startsWith(OWN_PREFIX)) {
    return SOURCE_EXTENSIONS.map(
      (extension) => `${SRC}/${bare.slice(OWN_PREFIX.length)}${extension}`,
    )
  }

  return bare.startsWith('.')
    ? SOURCE_EXTENSIONS.map((extension) => `${resolvedFrom(from, bare)}${extension}`)
    : []
}

const firstFile = (fileSystem: FileSystem.FileSystem, candidates: readonly string[]) =>
  Effect.findFirst(candidates, (candidate) =>
    fileSystem.stat(candidate).pipe(
      Effect.map((info) => info.type === 'File'),
      Effect.orElseSucceed(() => false),
    ),
  )

const reachableFrom = (entries: readonly string[]) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const seen = new Set<string>()

    const visit = (file: string): Effect.Effect<void, PlatformError> =>
      Effect.gen(function* () {
        if (seen.has(file)) {
          return
        }

        seen.add(file)

        const text = yield* fileSystem.readFileString(file)
        const next = yield* Effect.forEach(specifiersOf(text), (specifier) =>
          firstFile(fileSystem, candidatesOf(specifier, file)),
        )

        yield* Effect.forEach(Arr.getSomes(next), visit, { discard: true })
      })

    yield* Effect.forEach(entries, visit, { discard: true })

    return [...seen]
  })

const outsideProduction = (file: string): boolean =>
  file.startsWith(STORIES) || file.startsWith(TEST)

const compiledFrom = (entry: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const css = yield* fileSystem.readFileString(entry)

    const compiler = yield* Effect.promise(() =>
      compile(css, {
        base: directoryOf(entry),
        onDependency: () => {},
        shouldRewriteUrls: true,
      }),
    )
    const detected =
      compiler.root === 'none' ? [] : [{ base: WEB_ROOT, pattern: '**/*', negated: false }]
    const scanner = new Scanner({ sources: [...detected, ...compiler.sources] })

    return compiler.build(scanner.scan())
  })

layer(BunFileSystem.layer)('what reaches production', (effectIt) => {
  effectIt.effect('no module the app or its worker loads lives in the catalog or the tests', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const html = yield* fileSystem.readFileString(`${WEB_ROOT}index.html`)
      const scripts = Array.from(html.matchAll(HTML_SCRIPT_PATTERN), (found) => found[1] ?? '')
      const entries = [
        ...Arr.map(scripts, (script) => `${WEB_ROOT}${script.replace(/^\//u, '')}`),
        `${SRC}/sw/ServiceWorker.ts`,
      ]
      const reached = yield* reachableFrom(entries)

      expect(reached.length).toBeGreaterThan(entries.length)
      expect(reached.filter(outsideProduction)).toEqual([])
    }),
  )

  effectIt.effect('the real walk would notice a story imported by the app', () =>
    Effect.gen(function* () {
      const reached = yield* reachableFrom([`${STORIES}/ShellMain.tsx`])

      expect(reached.filter(outsideProduction).length).toBeGreaterThan(0)
    }),
  )

  effectIt.effect('the app build config names no story', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const viteConfig = yield* fileSystem.readFileString(`${WEB_ROOT}vite.config.ts`)

      expect(viteConfig).not.toContain('stories')
    }),
  )

  effectIt.effect('the production stylesheet carries no class only a story or prototype uses', () =>
    Effect.acquireUseRelease(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem

        yield* fileSystem.makeDirectory(KITCHEN_PROBE_FOLDER, { recursive: true })
        yield* fileSystem.writeFileString(
          `${KITCHEN_PROBE_FOLDER}/Probe.tsx`,
          `export const CLASS_NAME = '${KITCHEN_PROBE_CLASS}'\n`,
        )

        return fileSystem
      }),
      () =>
        Effect.gen(function* () {
          const production = yield* compiledFrom(`${SRC}/app.css`)
          const catalog = yield* compiledFrom(`${STORIES}/stories.css`)

          expect(production.includes(STORY_ONLY_COLOUR)).toBe(false)
          expect(production.includes(KITCHEN_ONLY_COLOUR)).toBe(false)
          expect(catalog.includes(STORY_ONLY_COLOUR)).toBe(true)
          expect(catalog.includes(KITCHEN_ONLY_COLOUR)).toBe(true)
        }),
      (fileSystem) => Effect.orDie(fileSystem.remove(KITCHEN_PROBE_FOLDER, { recursive: true })),
    ),
  )
})
