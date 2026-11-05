import * as Effect from 'effect/Effect'
import { createServer } from 'vite'

import type { Story } from './Story.tsx'

const ORIGIN = 'http://localhost:5192'

const lineOf = (story: Story): string =>
  [
    story.id,
    story.kind,
    `${ORIGIN}/stories/?story=${encodeURIComponent(story.id)}`,
    `${ORIGIN}/stories/frame.html?story=${encodeURIComponent(story.id)}`,
    ...(story.kind === 'transition'
      ? [`${ORIGIN}/stories/frame.html?story=${encodeURIComponent(story.id)}&autoplay=1`]
      : []),
  ].join('\t')

const program = Effect.gen(function* () {
  const server = yield* Effect.acquireRelease(
    Effect.promise(() =>
      createServer({
        configFile: new URL('../vite.stories.config.ts', import.meta.url).pathname,
        root: new URL('..', import.meta.url).pathname,
        logLevel: 'silent',
        server: { middlewareMode: true, hmr: false, ws: false },
        appType: 'custom',
        optimizeDeps: { noDiscovery: true, include: [] },
      }),
    ),
    (made) => Effect.promise(() => made.close()),
  )
  const catalog = yield* Effect.promise(() => server.ssrLoadModule('/stories/Catalog.ts'))
  // oxlint-disable-next-line typescript/no-unsafe-assignment
  const stories: readonly Story[] = catalog['STORIES']

  yield* Effect.sync(() => {
    process.stdout.write(`${stories.map(lineOf).join('\n')}\n`)
  })
})

Effect.runFork(Effect.scoped(program))
