import type * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import type * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import type * as Scope from 'effect/Scope'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'

import { SentBound } from '@crook/web/atoms/SentBound'
import type { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { TranscriptCache } from '@crook/web/cache/TranscriptCache'
import { HubLink } from '@crook/web/rpc/HubLink'
import type { HubUploads } from '@crook/web/rpc/HubUploads'
import { COLD_START, HubLinkState } from '@crook/web/rpc/HubLinkState'

import { appRegistry, appRouter, AppTree } from '../test/AppWiring.tsx'
import { makeFakeBrowser, makeFakeHubLink, makeMemoryTranscriptStore } from '../test/HubFakes.ts'
import type { FakeSession } from '../test/HubFakes.ts'

export type StoryKind = 'state' | 'transition'

export interface StoryEnv {
  readonly standalone: boolean
  readonly userAgent: Option.Option<string>
  readonly maxTouchPoints: Option.Option<number>
  readonly reducedMotion: boolean
  readonly keyboardUp: boolean
}

export interface StepInfo {
  readonly label: string
  readonly delayMs: number
}

export type StoryScene = (root: HTMLElement) => Effect.Effect<void, never, Scope.Scope>

export interface RunningStory {
  readonly render: StoryScene
  readonly settle: Effect.Effect<void, StoryStepFailed>
  readonly steps: readonly Effect.Effect<void, StoryStepFailed>[]
}

export type Witness =
  | { readonly text: string }
  | { readonly selector: string }
  | { readonly absent: string }
  | { readonly field: string }
  | { readonly all: readonly Witness[] }

export interface Story {
  readonly id: string
  readonly group: string
  readonly title: string
  readonly note: Option.Option<string>
  readonly path: string
  readonly env: StoryEnv
  readonly kind: StoryKind
  readonly steps: readonly StepInfo[]
  readonly witness: Option.Option<Witness>
  readonly endWitness: Option.Option<Witness>
  readonly start: Effect.Effect<RunningStory, StoryStepFailed, Scope.Scope>
}

export interface TimelineStep<Stage> {
  readonly delayMs: number
  readonly label: string
  readonly run: (stage: Stage) => Effect.Effect<void, StoryStepFailed>
}

export interface AppHandles {
  readonly router: ReturnType<typeof appRouter>
  readonly registry: AtomRegistry.AtomRegistry
}

export type FakeLink = Effect.Success<ReturnType<typeof makeFakeHubLink>>

export type FakeBrowser = Effect.Success<ReturnType<typeof makeFakeBrowser>>

export interface LinkStage extends AppHandles {
  readonly link: FakeLink
}

export interface BrowserStage extends AppHandles {
  readonly browser: FakeBrowser
  readonly session: Ref.Ref<Option.Option<FakeSession>>
}

export interface StorySpec<Stage> {
  readonly slug: string
  readonly title: string
  readonly note?: string
  readonly path: string
  readonly env?: Partial<StoryEnv>
  readonly shows: Witness
  readonly ends?: Witness
  readonly arrange?: (stage: Stage) => Effect.Effect<void, StoryStepFailed>
  readonly settle?: (stage: Stage) => Effect.Effect<void, StoryStepFailed>
  readonly timeline?: readonly TimelineStep<Stage>[]
}

export interface LinkStorySpec extends StorySpec<LinkStage> {
  readonly link: HubLinkState | typeof BEFORE_FIRST_VALUE
  readonly sentBound?: Duration.Duration
}

export interface BrowserStorySpec extends StorySpec<BrowserStage> {
  readonly cached: Option.Option<HerdSnapshot>
}

export type StoryMaker = (group: string) => Story

export const BEFORE_FIRST_VALUE = 'before first value'

export const DEFAULT_ENV: StoryEnv = {
  standalone: true,
  userAgent: Option.none(),
  maxTouchPoints: Option.none(),
  reducedMotion: false,
  keyboardUp: false,
}

export class StoryStepFailed extends Schema.TaggedError<StoryStepFailed>()('StoryStepFailed', {
  step: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `The story step "${this.step}" failed: ${this.detail} Check what the story seeds against what the screen now needs.`
  }
}

export const step = <Stage,>(
  delayMs: number,
  label: string,
  run: (stage: Stage) => Effect.Effect<void, StoryStepFailed>,
): TimelineStep<Stage> => ({ delayMs, label, run })

const describeSpec = <Stage,>(spec: StorySpec<Stage>, group: string) => ({
  id: `${group}/${spec.slug}`,
  group,
  title: spec.title,
  note: Option.fromUndefinedOr(spec.note),
  path: spec.path,
  env: { ...DEFAULT_ENV, ...spec.env },
  kind: spec.timeline === undefined ? ('state' as const) : ('transition' as const),
  steps: (spec.timeline ?? []).map(({ label, delayMs }) => ({ label, delayMs })),
  witness: Option.some(spec.shows),
  endWitness: Option.fromUndefinedOr(spec.ends),
})

export const mountedScene =
  (tree: ReactNode, load: () => Promise<void>): StoryScene =>
  (root) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const reactRoot = createRoot(root)

          reactRoot.render(<StrictMode>{tree}</StrictMode>)

          return reactRoot
        }),
        (reactRoot) =>
          Effect.sync(() => {
            reactRoot.unmount()
          }),
      )
      yield* Effect.promise(load)
    })

const appScene = ({ registry, router }: AppHandles): StoryScene =>
  mountedScene(<AppTree registry={registry} router={router} />, () => router.load())

const running = <Stage extends AppHandles>(spec: StorySpec<Stage>, stage: Stage): RunningStory => ({
  render: appScene(stage),
  settle: Effect.suspend(() => (spec.settle === undefined ? Effect.void : spec.settle(stage))),
  steps: (spec.timeline ?? []).map(({ run }) => Effect.suspend(() => run(stage))),
})

export const acquireRegistry = (hub: Layer.Layer<HubLink | TranscriptCache | HubUploads>) =>
  Effect.acquireRelease(
    Effect.sync(() => appRegistry(hub)),
    (registry) =>
      Effect.sync(() => {
        registry.dispose()
      }),
  )

const arranged = <Stage extends AppHandles>(spec: StorySpec<Stage>, stage: Stage) =>
  spec.arrange === undefined
    ? Effect.succeed(running(spec, stage))
    : Effect.as(Effect.orDie(spec.arrange(stage)), running(spec, stage))

export const linkStory =
  (spec: LinkStorySpec): StoryMaker =>
  (group) => ({
    ...describeSpec(spec, group),
    start: Effect.gen(function* () {
      const link = yield* makeFakeHubLink(
        spec.link === BEFORE_FIRST_VALUE
          ? new HubLinkState({ status: COLD_START, herd: Option.none() })
          : spec.link,
      )

      if (spec.link === BEFORE_FIRST_VALUE) {
        yield* link.stateReads.close
      }

      const registry = yield* acquireRegistry(
        spec.sentBound === undefined
          ? link.layer
          : Layer.merge(link.layer, Layer.succeed(SentBound, spec.sentBound)),
      )

      return yield* arranged(spec, { link, registry, router: appRouter(spec.path) })
    }),
  })

export const browserStory =
  (spec: BrowserStorySpec): StoryMaker =>
  (group) => ({
    ...describeSpec(spec, group),
    start: Effect.gen(function* () {
      const browser = yield* makeFakeBrowser(spec.cached)
      const transcripts = yield* makeMemoryTranscriptStore()
      const registry = yield* acquireRegistry(
        Layer.mergeAll(
          Layer.provide(
            Layer.mergeAll(HubLink.layer, TranscriptCache.layerOver(transcripts.store)),
            browser.layer,
          ),
          browser.uploads.layer,
        ),
      )

      const session = yield* Ref.make(Option.none<FakeSession>())

      return yield* arranged(spec, { browser, session, registry, router: appRouter(spec.path) })
    }),
  })
