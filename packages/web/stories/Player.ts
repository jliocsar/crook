import * as Cause from 'effect/Cause'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Scope from 'effect/Scope'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import { sees } from './StageDom.ts'
import { StoryStepFailed } from './Story.tsx'
import type { RunningStory, StepInfo, Story } from './Story.tsx'

export type PlayerPhase = 'mounting' | 'ready' | 'playing' | 'paused' | 'done' | 'failed'

export interface StepLogEntry {
  readonly index: number
  readonly label: string
  readonly at: number
}

export interface PlayerSnapshot {
  readonly phase: PlayerPhase
  readonly position: number
  readonly failure: string | null
  readonly log: readonly StepLogEntry[]
}

export interface PlayOptions {
  readonly speed?: number
}

export interface StoryApi {
  readonly id: string
  readonly title: string
  readonly group: string
  readonly kind: Story['kind']
  readonly path: string
  readonly steps: () => readonly (StepInfo & { readonly index: number })[]
  readonly snapshot: () => PlayerSnapshot
  readonly ready: () => Promise<void>
  readonly done: () => Promise<void>
  readonly step: () => Promise<void>
  readonly play: (options?: PlayOptions) => Promise<void>
  readonly pause: () => Promise<void>
  readonly reset: () => Promise<void>
  readonly replay: (options?: PlayOptions) => Promise<void>
  readonly subscribe: (listener: (snapshot: PlayerSnapshot) => void) => () => void
}

interface PlayerControls {
  readonly snapshot: SubscriptionRef.SubscriptionRef<PlayerSnapshot>
  readonly readyOf: Effect.Effect<void, StoryStepFailed>
  readonly doneOf: Effect.Effect<void, StoryStepFailed>
  readonly stepOnce: Effect.Effect<void, StoryStepFailed>
  readonly pause: Effect.Effect<void>
  readonly resetAndWait: Effect.Effect<void, StoryStepFailed>
  readonly playToEnd: (options: PlayOptions | undefined) => Effect.Effect<void, StoryStepFailed>
  readonly replayToEnd: (options: PlayOptions | undefined) => Effect.Effect<void, StoryStepFailed>
}

interface Generation {
  readonly scope: Scope.Closeable
  readonly running: Deferred.Deferred<RunningStory, StoryStepFailed>
  readonly ready: Deferred.Deferred<void, StoryStepFailed>
  readonly done: Deferred.Deferred<void, StoryStepFailed>
}

const INITIAL: PlayerSnapshot = {
  phase: 'mounting',
  position: 0,
  failure: null,
  log: [],
}

const makeGeneration = Effect.gen(function* () {
  return {
    scope: yield* Scope.make(),
    running: yield* Deferred.make<RunningStory, StoryStepFailed>(),
    ready: yield* Deferred.make<void, StoryStepFailed>(),
    done: yield* Deferred.make<void, StoryStepFailed>(),
  }
})

const makeApi = (story: Story, controls: PlayerControls): StoryApi => ({
  id: story.id,
  title: story.title,
  group: story.group,
  kind: story.kind,
  path: story.path,
  steps: () => story.steps.map((info, index) => ({ ...info, index })),
  snapshot: () => Effect.runSync(SubscriptionRef.get(controls.snapshot)),
  ready: () => Effect.runPromise(controls.readyOf),
  done: () => Effect.runPromise(controls.doneOf),
  step: () => Effect.runPromise(controls.stepOnce),
  play: (options) => Effect.runPromise(controls.playToEnd(options)),
  pause: () => Effect.runPromise(controls.pause),
  reset: () => Effect.runPromise(controls.resetAndWait),
  replay: (options) => Effect.runPromise(controls.replayToEnd(options)),
  subscribe: (listener) => {
    const fiber = Effect.runFork(
      SubscriptionRef.changes(controls.snapshot).pipe(
        Stream.runForEach((next) =>
          Effect.sync(() => {
            listener(next)
          }),
        ),
      ),
    )

    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  },
})

export const makePlayer = Effect.fn('makePlayer')(function* (story: Story, root: HTMLElement) {
  const snapshot = yield* SubscriptionRef.make(INITIAL)
  const generation = yield* Ref.make(yield* makeGeneration)
  const playing = yield* Ref.make(Option.none<Fiber.Fiber<void>>())
  const update = (change: Partial<PlayerSnapshot>) =>
    SubscriptionRef.update(snapshot, (current) => ({ ...current, ...change }))

  const failWith = Effect.fn('Player.failWith')(function* (
    current: Generation,
    failure: StoryStepFailed,
  ) {
    yield* Effect.logError(failure.message)
    yield* update({ phase: 'failed', failure: failure.message })
    yield* Deferred.fail(current.done, failure)
  })

  const finishIfLast = Effect.fn('Player.finishIfLast')(function* (current: Generation) {
    const { position } = yield* SubscriptionRef.get(snapshot)

    if (position >= story.steps.length) {
      yield* update({ phase: 'done' })
      yield* Deferred.succeed(current.done, undefined)
    }
  })

  const mount = Effect.fn('Player.mount')(function* (current: Generation) {
    const scene = yield* Effect.provideService(story.start, Scope.Scope, current.scope)

    yield* Deferred.succeed(current.running, scene)
    yield* Effect.provideService(scene.render(root), Scope.Scope, current.scope)
    yield* scene.settle
    yield* Option.match(story.witness, { onNone: () => Effect.void, onSome: sees })
    yield* update({ phase: 'ready' })
    yield* Deferred.succeed(current.ready, undefined)
    yield* finishIfLast(current)
  })

  const startGeneration = Effect.gen(function* () {
    const current = yield* Ref.get(generation)

    yield* mount(current).pipe(
      Effect.catchCause((cause) => {
        const failure = new StoryStepFailed({ step: 'mount', detail: Cause.pretty(cause) })

        return Effect.andThen(failWith(current, failure), Deferred.fail(current.ready, failure))
      }),
      Effect.forkDetach,
    )
  })

  const runNext = Effect.fn('Player.runNext')(function* (current: Generation) {
    const { position, log } = yield* SubscriptionRef.get(snapshot)
    const scene = yield* Deferred.await(current.running)

    yield* scene.steps[position] ?? Effect.void
    yield* update({
      position: position + 1,
      log: [
        ...log,
        {
          index: position,
          label: story.steps[position]?.label ?? '',
          at: performance.now(),
        },
      ],
    })
    yield* finishIfLast(current)
  })

  const stopPlaying = Effect.gen(function* () {
    const fiber = yield* Ref.getAndSet(playing, Option.none())

    yield* Option.match(fiber, { onNone: () => Effect.void, onSome: Fiber.interrupt })
  })

  const playRest = (current: Generation, speed: number): Effect.Effect<void, StoryStepFailed> =>
    Effect.gen(function* () {
      const { position } = yield* SubscriptionRef.get(snapshot)
      const next = story.steps[position]

      if (next === undefined) {
        return
      }

      yield* Effect.sleep(Duration.millis(next.delayMs / speed))
      yield* Effect.uninterruptible(runNext(current))
      yield* playRest(current, speed)
    })

  const playLoop = (current: Generation, speed: number) =>
    Effect.gen(function* () {
      yield* Deferred.await(current.ready)
      yield* update({ phase: 'playing' })
      yield* playRest(current, speed)
    })

  const play = Effect.fn('Player.play')(function* (options: PlayOptions | undefined) {
    const current = yield* Ref.get(generation)

    yield* stopPlaying

    const fiber = yield* playLoop(current, options?.speed ?? 1).pipe(
      Effect.catch((failure) => failWith(current, failure)),
      Effect.forkDetach,
    )

    yield* Ref.set(playing, Option.some(fiber))

    return current
  })

  const pause = Effect.gen(function* () {
    yield* stopPlaying

    const { phase } = yield* SubscriptionRef.get(snapshot)

    if (phase === 'playing') {
      yield* update({ phase: 'paused' })
    }
  })

  const stepOnce = Effect.gen(function* () {
    const current = yield* Ref.get(generation)

    yield* stopPlaying
    yield* Deferred.await(current.ready)

    const { phase, position } = yield* SubscriptionRef.get(snapshot)

    if (phase === 'failed' || position >= story.steps.length) {
      return
    }

    yield* update({ phase: 'paused' })
    yield* runNext(current).pipe(Effect.catch((failure) => failWith(current, failure)))
  })

  const reset = Effect.gen(function* () {
    yield* stopPlaying

    const previous = yield* Ref.get(generation)

    yield* Scope.close(previous.scope, Exit.void)
    yield* Deferred.succeed(previous.done, undefined)
    yield* Ref.set(generation, yield* makeGeneration)
    yield* SubscriptionRef.set(snapshot, INITIAL)
    yield* startGeneration
  })

  const readyOf = Effect.flatMap(Ref.get(generation), (current) => Deferred.await(current.ready))
  const doneOf = Effect.flatMap(Ref.get(generation), (current) => Deferred.await(current.done))

  yield* startGeneration

  return makeApi(story, {
    snapshot,
    readyOf,
    doneOf,
    stepOnce,
    pause,
    resetAndWait: Effect.andThen(reset, readyOf),
    playToEnd: (options) =>
      Effect.flatMap(play(options), (current) => Deferred.await(current.done)),
    replayToEnd: (options) =>
      reset.pipe(
        Effect.andThen(play(options)),
        Effect.flatMap((current) => Deferred.await(current.done)),
      ),
  })
})
