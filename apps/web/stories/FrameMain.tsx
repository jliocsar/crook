import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

import { loadFontsEarly } from '@crook/web/text/Fonts'

import { STORIES } from './Catalog.ts'
import { makePlayer } from './Player.ts'
import type { StoryApi } from './Player.ts'
import { applyStoryEnv, startClockAtFixtures } from './StoryEnv.ts'
import './stories.css'

const ROOT_ELEMENT_ID = 'root'
const STORY_PARAM = 'story'
const AUTOPLAY_PARAM = 'autoplay'
const SPEED_PARAM = 'speed'

const params = new URLSearchParams(window.location.search)

const requested = Option.fromNullishOr(params.get(STORY_PARAM))

const speed = Option.getOrElse(
  Option.filter(
    Option.map(Option.fromNullishOr(params.get(SPEED_PARAM)), Number),
    (value) => value > 0,
  ),
  () => 1,
)

const story = Option.flatMap(requested, (id) => Arr.findFirst(STORIES, (found) => found.id === id))

const root = Option.fromNullishOr(document.getElementById(ROOT_ELEMENT_ID))

const showsPhase = (api: StoryApi) =>
  api.subscribe((snapshot) => {
    document.documentElement.dataset['storyPhase'] = snapshot.phase
  })

const boot = Effect.gen(function* () {
  const chosen = yield* Effect.fromOption(story)
  const mountPoint = yield* Effect.fromOption(root)

  applyStoryEnv(chosen.env)
  startClockAtFixtures()

  const api = yield* makePlayer(chosen, mountPoint)

  Object.assign(window, { __story: api })
  showsPhase(api)

  if (params.has(AUTOPLAY_PARAM)) {
    void api.play({ speed })
  }
})

const unknownStory = Effect.sync(() => {
  document.body.textContent = `No story "${Option.getOrElse(requested, () => '')}". Run bun run stories:list for every id.`
})

Effect.runFork(loadFontsEarly)
Effect.runFork(boot.pipe(Effect.catch(() => unknownStory)))

declare global {
  interface Window {
    __story?: StoryApi
  }
}
