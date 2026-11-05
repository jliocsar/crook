import * as BunRuntime from '@effect/platform-bun/BunRuntime'
import * as BunServices from '@effect/platform-bun/BunServices'
import * as Arr from 'effect/Array'
import * as Argument from 'effect/cli/Argument'
import * as Command from 'effect/cli/Command'
import * as Flag from 'effect/cli/Flag'
import * as Clock from 'effect/Clock'
import * as Console from 'effect/Console'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Path from 'effect/Path'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import * as FetchHttpClient from 'effect/http/FetchHttpClient'
import * as HttpClient from 'effect/http/HttpClient'
import * as ChildProcess from 'effect/process/ChildProcess'
import { ChildProcessSpawner } from 'effect/process/ChildProcessSpawner'
import * as Socket from 'effect/socket/Socket'

import { Baseline, isClean, verdictOf } from '@crook/frames/Baseline'
import type { Verdict } from '@crook/frames/Baseline'
import { openBrowser } from '@crook/frames/Browser'
import type { Page } from '@crook/frames/Browser'
import { captureStory, renderSheet, warmUp } from '@crook/frames/Capture'
import type { CapturedStory } from '@crook/frames/Capture'
import { flaggedFrames, sheetHtml, SHEET_WIDTH, tileFrames } from '@crook/frames/ContactSheet'
import { detect, Finding } from '@crook/frames/Detect'
import { expectationOf, TIMELINE_STORY_IDS } from '@crook/frames/Expectations'
import { isStarved, p90FrameMs, STARVED_P90_FRAME_MS } from '@crook/frames/FrameLog'
import { verdictLines } from '@crook/frames/Report'
import { imageWithItsAge, NO_IMAGE, shotOfFrame } from '@crook/frames/Shots'

import baselineJson from '../baseline.json' with { type: 'json' }
import packageJson from '../package.json' with { type: 'json' }

const STORIES_ORIGIN = 'http://localhost:5192/stories/frame.html'
const SERVER_START_TIMEOUT_MS = 30_000
const SERVER_POLL_MS = 250
const RECORDER_ENTRY = 'packages/frames/src/Recorder.ts'
const DEFAULT_OUTPUT = 'tmp/frames'
const ATTEMPTS_AT_A_STARVED_STORY = 3

export class FramesFailed extends Schema.TaggedError<FramesFailed>()('FramesFailed', {
  failed: Schema.Array(Schema.String),
}) {
  override get message(): string {
    return `frames failed on ${this.failed.join(', ')}. Each story's findings are above, with a frame image for each. A finding that is expected until its bug ticket lands goes in packages/frames/baseline.json; anything else is a bug.`
  }
}

export class NoStoryNamed extends Schema.TaggedError<NoStoryNamed>()('NoStoryNamed', {}) {
  override get message(): string {
    return 'Name at least one story, or pass --all for the timeline stories a sweep plays. bun run stories:list prints every id.'
  }
}

export class RecorderNotBuilt extends Schema.TaggedError<RecorderNotBuilt>()('RecorderNotBuilt', {
  detail: Schema.String,
}) {
  override get message(): string {
    return `Could not build the recorder from ${RECORDER_ENTRY}: ${this.detail}`
  }
}

export class RouteTreeNotGenerated extends Schema.TaggedError<RouteTreeNotGenerated>()(
  'RouteTreeNotGenerated',
  { exitCode: Schema.Int },
) {
  override get message(): string {
    return `tsr generate exited with ${this.exitCode}, so the catalog cannot load. Run it in packages/web to see why.`
  }
}

export class StoriesServerDown extends Schema.TaggedError<StoriesServerDown>()(
  'StoriesServerDown',
  {},
) {
  override get message(): string {
    return `The stories server did not answer at ${STORIES_ORIGIN} within ${SERVER_START_TIMEOUT_MS} ms. Run bun run stories on its own to see why.`
  }
}

const repositoryRoot = Effect.gen(function* () {
  const path = yield* Path.Path

  return path.resolve(import.meta.dirname, '..', '..', '..')
})

const buildRecorder = Effect.fn('frames.buildRecorder')(function* (root: string, output: string) {
  const fileSystem = yield* FileSystem.FileSystem
  const file = `${output}/recorder.js`
  const built = yield* Effect.tryPromise({
    try: () =>
      Bun.build({
        entrypoints: [`${root}/${RECORDER_ENTRY}`],
        target: 'browser',
        format: 'iife',
      }).then((result) => result.outputs[0]?.text() ?? ''),
    catch: (cause) => new RecorderNotBuilt({ detail: String(cause) }),
  })

  yield* fileSystem.makeDirectory(output, { recursive: true })
  yield* fileSystem.writeFileString(file, built)

  return file
})

const storiesAnswer = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient

  yield* client.get(STORIES_ORIGIN).pipe(Effect.flatMap((response) => response.text))
})

const keepStoriesServer = Effect.fn('frames.keepStoriesServer')(function* (root: string) {
  const spawner = yield* ChildProcessSpawner
  const web = `${root}/packages/web`

  yield* spawner
    .exitCode(
      ChildProcess.make('bun', ['x', 'tsr', 'generate'], {
        cwd: web,
        stdout: 'ignore',
        stderr: 'ignore',
      }),
    )
    .pipe(
      Effect.filterOrFail(
        (exitCode) => exitCode === 0,
        (exitCode) => new RouteTreeNotGenerated({ exitCode }),
      ),
    )
  yield* spawner.spawn(
    ChildProcess.make(
      'bun',
      ['x', 'vite', '--config', 'vite.stories.config.ts', '--port', '5192', '--strictPort'],
      { cwd: web, stdout: 'ignore', stderr: 'ignore' },
    ),
  )
  yield* storiesAnswer.pipe(
    Effect.retry(Schedule.spaced(Duration.millis(SERVER_POLL_MS))),
    Effect.timeoutOrElse({
      duration: Duration.millis(SERVER_START_TIMEOUT_MS),
      orElse: () => Effect.fail(new StoriesServerDown()),
    }),
  )
})

const ensureStoriesServer = (root: string) =>
  storiesAnswer.pipe(Effect.catch(() => keepStoriesServer(root)))

const imageOfFrame =
  (captured: CapturedStory) =>
  (frame: number): string =>
    Option.match(shotOfFrame(captured.shots, captured.log.frames, frame), {
      onNone: () => NO_IMAGE,
      onSome: (shot) => shot.file,
    })

const writeSheet = Effect.fn('frames.writeSheet')(function* (
  page: Page,
  captured: CapturedStory,
  findings: readonly Finding[],
) {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const flagged = flaggedFrames(findings)
  const frames = tileFrames(
    captured.log.frames.filter((frame) => frame.mounted),
    flagged,
  )
  const imageOf = imageOfFrame(captured)
  const relative = frames.map((frame) => ({
    frame,
    image: path.relative(captured.folder, imageOf(frame.frame)),
    flagged: flagged.has(frame.frame),
  }))
  const inlined = yield* Effect.forEach(frames, (frame) =>
    fileSystem.readFile(imageOf(frame.frame)).pipe(
      Effect.map((bytes) => ({
        frame,
        image: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`,
        flagged: flagged.has(frame.frame),
      })),
      Effect.orElseSucceed(() => ({ frame, image: '', flagged: flagged.has(frame.frame) })),
    ),
  )
  const png = yield* renderSheet(page, sheetHtml(captured.story, inlined), SHEET_WIDTH)
  const sheetPath = path.join(captured.folder, 'contact-sheet.png')

  yield* fileSystem.writeFileString(
    path.join(captured.folder, 'contact-sheet.html'),
    sheetHtml(captured.story, relative),
  )
  yield* fileSystem.writeFile(sheetPath, Buffer.from(png, 'base64'))

  return sheetPath
})

const StoryResult = Schema.Struct({
  story: Schema.String,
  findings: Schema.Array(Finding),
  storyFailure: Schema.Option(Schema.String),
})
type StoryResult = typeof StoryResult.Type

const SummaryFile = Schema.fromJsonString(Schema.toCodecJson(Schema.Array(StoryResult)))

const decodeBaseline = Schema.decodeEffect(Baseline)

const captureSettled = (
  page: Page,
  story: string,
  output: string,
  attemptsLeft: number,
): Effect.Effect<
  CapturedStory,
  Effect.Error<ReturnType<typeof captureStory>>,
  Effect.Services<ReturnType<typeof captureStory>>
> =>
  captureStory(page, story, output).pipe(
    Effect.catchTag('BrowserFailed', (failure) =>
      attemptsLeft <= 1
        ? Effect.fail(failure)
        : Console.log(`  ${story}: ${failure.message} Running it again.`).pipe(
            Effect.andThen(captureSettled(page, story, output, attemptsLeft - 1)),
          ),
    ),
    Effect.filterOrElse(
      (captured) => attemptsLeft <= 1 || !isStarved(captured.log.frames),
      () =>
        Console.log(`  ${story} was starved of frames by other work, running it again.`).pipe(
          Effect.andThen(captureSettled(page, story, output, attemptsLeft - 1)),
        ),
    ),
  )

const judgeStory = Effect.fn('frames.judgeStory')(function* (
  page: Page,
  story: string,
  output: string,
  baseline: Baseline,
) {
  const captured = yield* captureSettled(page, story, output, ATTEMPTS_AT_A_STARVED_STORY)
  const findings = detect(story, captured.log, expectationOf(story))
  const verdict: Verdict = verdictOf(story, findings, baseline)
  const sheetPath = yield* writeSheet(page, captured, findings)

  yield* Console.log(
    verdictLines(
      verdict,
      (frame) => imageWithItsAge(captured.shots, captured.log.frames, frame),
      sheetPath,
    ).join('\n'),
  )
  yield* Effect.when(
    Console.log(
      `  STARVED A tenth of this run's frames took over ${Math.round(p90FrameMs(captured.log.frames))} ms, past the ${STARVED_P90_FRAME_MS} ms that marks a starved run, so its frame counts mean little. Run the story again when the machine is quieter before believing it.`,
    ),
    Effect.succeed(isStarved(captured.log.frames)),
  )
  yield* Option.match(captured.storyFailure, {
    onNone: () => Effect.void,
    onSome: (failure) => Console.log(`  STORY FAILED ${failure}`),
  })

  return { verdict, result: { story, findings, storyFailure: captured.storyFailure } }
})

const run = Effect.fn('frames.run')(function* (input: {
  readonly stories: readonly string[]
  readonly all: boolean
  readonly noBaseline: boolean
  readonly output: string
}) {
  const names = input.all ? [...TIMELINE_STORY_IDS, ...input.stories] : input.stories

  if (!Arr.isReadonlyArrayNonEmpty(names)) {
    return yield* new NoStoryNamed()
  }

  const started = yield* Clock.currentTimeMillis
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* repositoryRoot
  const output = path.resolve(root, input.output)
  const baseline: Baseline = input.noBaseline ? {} : yield* decodeBaseline(baselineJson)
  const recorder = yield* buildRecorder(root, output)

  yield* ensureStoriesServer(root)

  const page = yield* openBrowser(recorder)

  yield* warmUp(page)

  const judged = yield* Effect.forEach(names, (story) => judgeStory(page, story, output, baseline))
  const failed = judged
    .filter(({ verdict, result }) => !isClean(verdict) || Option.isSome(result.storyFailure))
    .map(({ verdict }) => verdict.story)
  const finished = yield* Clock.currentTimeMillis
  const summary = yield* Schema.encodeEffect(SummaryFile)(judged.map(({ result }) => result))

  yield* fileSystem.writeFileString(path.join(output, 'summary.json'), summary)
  yield* Console.log(
    `frames: ${judged.length} stories, ${failed.length} failed, ${Math.round((finished - started) / 1000)} s. Logs and shots under ${output}.`,
  )

  if (failed.length > 0) {
    return yield* new FramesFailed({ failed })
  }

  return undefined
}, Effect.scoped)

const frames = Command.make(
  'frames',
  {
    stories: Argument.String('story').pipe(
      Argument.atLeast(0),
      Argument.withDescription('A story id. bun run stories:list prints them.'),
    ),
    all: Flag.Boolean('all').pipe(
      Flag.withDefault(false),
      Flag.withDescription('Play every timeline story not waiting on reserved room.'),
    ),
    noBaseline: Flag.Boolean('no-baseline').pipe(
      Flag.withDefault(false),
      Flag.withDescription('Report every finding as new, as if nothing were known yet.'),
    ),
    output: Flag.String('output').pipe(
      Flag.withDefault(DEFAULT_OUTPUT),
      Flag.withDescription('Where logs, frames and contact sheets go, relative to the repository.'),
    ),
  },
  run,
).pipe(
  Command.withDescription(
    'Play stories from the catalog in a throttled browser and fail on what only shows between settled screens: flashes, forbidden pairs, layout shift, blank frames, empty bands in the thread and a state order the story does not allow.',
  ),
)

const program = Command.run(frames, { version: packageJson.version })

const services = Layer.mergeAll(
  BunServices.layer,
  FetchHttpClient.layer,
  Socket.layerWebSocketConstructorGlobal,
)

// oxlint-disable-next-line effecttsgo/strict-effect-provide
BunRuntime.runMain(program.pipe(Effect.provide(services)))
