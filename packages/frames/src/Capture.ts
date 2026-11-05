import * as Effect from 'effect/Effect'
import * as Duration from 'effect/Duration'
import * as Fiber from 'effect/Fiber'
import * as FileSystem from 'effect/FileSystem'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'

import { RETRY_POLL, SCREENCAST_OPTIONS, setCpuThrottle } from '@crook/frames/Browser'
import type { BrowserFailed, Page, ScreencastFrame } from '@crook/frames/Browser'
import { FrameLogJson } from '@crook/frames/FrameLog'
import type { FrameLog } from '@crook/frames/FrameLog'
import { Shot } from '@crook/frames/Shots'

export interface CapturedStory {
  readonly story: string
  readonly folder: string
  readonly log: FrameLog
  readonly shots: readonly Shot[]
  readonly storyFailure: Option.Option<string>
}

const ORIGIN = 'http://localhost:5192'
const FRAME_PAGE = `${ORIGIN}/stories/frame.html`
const WARM_UP_STORY = 'transition/machine-redial'
const STORY_TIMEOUT_MS = 60_000
const TAIL_MS = 2000
const SETTLED_PHASES: readonly string[] = ['ready', 'done', 'failed']
const ENDED_PHASES: readonly string[] = ['done', 'failed']
const FAILED_PHASE = 'failed'
const SHOT_NUMBER_WIDTH = 4

const READ_LOG =
  'JSON.stringify({ ...JSON.parse(window.__frames.read()), steps: window.__story?.snapshot().log ?? [] })'

export class StoryTimedOut extends Schema.TaggedError<StoryTimedOut>()('StoryTimedOut', {
  story: Schema.String,
  phases: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `The story ${this.story} did not reach ${this.phases.join(' or ')} in ${STORY_TIMEOUT_MS} ms. Check its id with bun run stories:list, and open it in the catalog.`
  }
}

class StillWaiting extends Schema.TaggedError<StillWaiting>()('StillWaiting', {}) {
  override get message(): string {
    return 'The story has not reached the phase yet.'
  }
}

export const frameUrl = (story: string, autoplay: boolean): string =>
  `${FRAME_PAGE}?story=${encodeURIComponent(story)}${autoplay ? '&autoplay=1' : ''}`

const phaseAt = (page: Page, url: string) =>
  page
    .evaluate(
      `location.href === ${JSON.stringify(url)} ? (document.documentElement.dataset.storyPhase ?? '') : ''`,
    )
    .pipe(
      Effect.map(String),
      Effect.orElseSucceed(() => ''),
    )

const waitForPhase = (page: Page, story: string, url: string, phases: readonly string[]) =>
  phaseAt(page, url).pipe(
    Effect.filterOrFail(
      (phase) => phases.includes(phase),
      () => new StillWaiting(),
    ),
    Effect.retry({ schedule: RETRY_POLL }),
    Effect.timeoutOrElse({
      duration: Duration.millis(STORY_TIMEOUT_MS),
      orElse: () => Effect.fail(new StoryTimedOut({ story, phases })),
    }),
  )

const navigate = (page: Page, url: string) => page.send('Page.navigate', { url })

export const warmUp = Effect.fn('Capture.warmUp')(function* (page: Page) {
  const url = frameUrl(WARM_UP_STORY, false)

  yield* navigate(page, url)
  yield* waitForPhase(page, WARM_UP_STORY, url, SETTLED_PHASES)
  yield* Effect.sleep(Duration.millis(TAIL_MS))
  yield* waitForPhase(page, WARM_UP_STORY, url, SETTLED_PHASES)
})

const keepShots = Effect.fn('Capture.keepShots')(function* (
  frames: Queue.Queue<ScreencastFrame>,
  shotsFolder: string,
  taken: Ref.Ref<readonly { readonly file: string; readonly timestampSeconds: number }[]>,
) {
  const fileSystem = yield* FileSystem.FileSystem

  while (true) {
    const { data, timestampSeconds } = yield* Queue.take(frames)
    const count = (yield* Ref.get(taken)).length
    const file = `${shotsFolder}/${String(count).padStart(SHOT_NUMBER_WIDTH, '0')}.jpg`

    yield* fileSystem.writeFile(file, Buffer.from(data, 'base64'))
    yield* Ref.update(taken, (shots) => [...shots, { file, timestampSeconds }])
  }
})

const decodeLog = Schema.decodeUnknownEffect(FrameLogJson)
const decodeText = Schema.decodeUnknownEffect(Schema.String)
const decodeFrameTree = Schema.decodeUnknownEffect(
  Schema.Struct({ frameTree: Schema.Struct({ frame: Schema.Struct({ id: Schema.String }) }) }),
)
const decodeScreenshot = Schema.decodeUnknownEffect(Schema.Struct({ data: Schema.String }))
const encodeShots = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Shot)))

export const captureStory = Effect.fn('Capture.captureStory')(function* (
  page: Page,
  story: string,
  outputFolder: string,
) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const folder = path.join(outputFolder, story.replaceAll('/', '_'))
  const shotsFolder = path.join(folder, 'shots')

  yield* fileSystem.remove(folder, { recursive: true, force: true })
  yield* fileSystem.makeDirectory(shotsFolder, { recursive: true })

  const warmUrl = frameUrl(story, false)

  yield* navigate(page, warmUrl)
  yield* waitForPhase(page, story, warmUrl, SETTLED_PHASES)
  yield* Queue.clear(page.screencastFrames)

  const taken = yield* Ref.make<
    readonly { readonly file: string; readonly timestampSeconds: number }[]
  >([])
  const keeper = yield* Effect.forkScoped(keepShots(page.screencastFrames, shotsFolder, taken))
  const url = frameUrl(story, true)

  yield* setCpuThrottle(page, true)
  yield* page.send('Page.startScreencast', SCREENCAST_OPTIONS)
  yield* navigate(page, url)

  const phase = yield* waitForPhase(page, story, url, ENDED_PHASES)

  yield* Effect.sleep(Duration.millis(TAIL_MS))
  yield* page.send('Page.stopScreencast')

  const raw = yield* Effect.flatMap(page.evaluate(READ_LOG), decodeText)

  yield* setCpuThrottle(page, false)
  yield* Fiber.interrupt(keeper)

  const log = yield* decodeLog(raw)
  const shots = (yield* Ref.get(taken)).map(({ file, timestampSeconds }, index) => ({
    index,
    file,
    at: timestampSeconds * 1000 - log.timeOrigin,
  }))

  yield* fileSystem.writeFileString(path.join(folder, 'log.json'), raw)
  yield* fileSystem.writeFileString(path.join(folder, 'shots.json'), encodeShots(shots))

  return {
    story,
    folder,
    log,
    shots,
    storyFailure:
      phase === FAILED_PHASE
        ? Option.some(`The story's own player reports it failed.`)
        : Option.none(),
  } satisfies CapturedStory
})

export const renderSheet = Effect.fn('Capture.renderSheet')(function* (
  page: Page,
  html: string,
  width: number,
) {
  yield* navigate(page, 'about:blank')

  const { frameTree } = yield* Effect.flatMap(page.send('Page.getFrameTree'), decodeFrameTree)

  yield* page.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html })
  yield* page.evaluate('Promise.all(Array.from(document.images).map((image) => image.decode()))')

  const height = yield* page.evaluate('document.documentElement.scrollHeight')
  const { data } = yield* Effect.flatMap(
    page.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: Number(height), scale: 1 },
    }),
    decodeScreenshot,
  )

  return data
})

export type { BrowserFailed }
