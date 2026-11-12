import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import { beforeAll, vi } from 'vitest'

import { CATALOG_STORIES } from '../../stories/Catalog.ts'
import { PlaybackSpeed, sees } from '../../stories/StageDom.ts'
import { applyStoryEnv, startClockAtFixtures } from '../../stories/StoryEnv.ts'
import * as Option from 'effect/Option'

const VIEWPORT_WIDTH = 390
const VIEWPORT_HEIGHT = 844
const SCROLL_HEIGHT = 100_000
const STORY_TIMEOUT_MS = 20_000
const NO_WAITS = Number.POSITIVE_INFINITY

beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEWPORT_WIDTH)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEWPORT_HEIGHT)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(SCROLL_HEIGHT)
})

describe('story paths', () => {
  it('spells a pane id as the router does, or a close from the chat never goes back', () => {
    expect(CATALOG_STORIES.filter((story) => story.path.includes(':')).map(({ id }) => id)).toEqual(
      [],
    )
  })
})

describe.each(CATALOG_STORIES.map((story) => [story.id, story] as const))('%s', (_id, story) => {
  it.live(
    'reaches its state and plays its timeline',
    () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const root = document.body.appendChild(document.createElement('div'))

        root.id = 'root'
        Reflect.deleteProperty(window, 'visualViewport')
        applyStoryEnv({ ...story.env, reducedMotion: false })
        startClockAtFixtures()

        const failure = yield* Effect.exit(
          Effect.gen(function* () {
            const running = yield* story.start

            yield* running.render(root)
            yield* running.settle
            yield* Option.match(story.witness, { onNone: () => Effect.void, onSome: sees })

            for (const next of running.steps) {
              yield* next
            }

            yield* Option.match(story.endWitness, { onNone: () => Effect.void, onSome: sees })
          }).pipe(
            Effect.provideService(Scope.Scope, scope),
            Effect.provideService(PlaybackSpeed, NO_WAITS),
          ),
        )

        yield* Scope.close(scope, Exit.void)
        root.remove()

        expect(Exit.isSuccess(failure) ? 'ok' : String(failure)).toBe('ok')
      }),
    STORY_TIMEOUT_MS,
  )
})
