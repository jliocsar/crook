import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Latch from 'effect/Latch'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schedule from 'effect/Schedule'
import * as Schema from 'effect/Schema'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import type * as AtomRegistry from 'effect/reactivity/AtomRegistry'

import { type GlobalPaneId, PaneId, toGlobalPaneId } from '@crook/domain/Ids'
import { draftAtom, draftPanesAtom } from '@crook/web/atoms/Drafts'
import { ComposerDraft, DraftCache, DraftKey } from '@crook/web/cache/DraftCache'

import { appRegistry, liveWith } from '../AppWiring.tsx'
import { agent, herd, LAPTOP, machine } from '../HerdFixtures.ts'
import { makeFakeHubLink } from '../HubFakes.ts'

const FIRST = new DraftKey({ machine: LAPTOP, pane: PaneId.make('w1:p1') })
const SECOND = new DraftKey({ machine: LAPTOP, pane: PaneId.make('w1:p2') })
const FIRST_PANE = toGlobalPaneId(FIRST.machine, FIRST.pane)
const SECOND_PANE = toGlobalPaneId(SECOND.machine, SECOND.pane)
const NO_PANES = Option.some([])
const SETTLE_POLLS = 200
const SETTLE_POLL_MS = 5

const bothPanes = liveWith(
  herd([machine(LAPTOP, [agent('w1:p1', 'idle'), agent('w1:p2', 'idle')])]),
)

class NotSettled extends Schema.TaggedError<NotSettled>()('NotSettled', {
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return 'The drafts had not settled into the state the test waits for.'
  }
}

const eventually = (assertion: () => void) =>
  Effect.try({ try: assertion, catch: (cause) => new NotSettled({ cause }) }).pipe(
    Effect.retry({ schedule: Schedule.spaced(SETTLE_POLL_MS), times: SETTLE_POLLS }),
    Effect.orDie,
  )

const typed = (text: string) => new ComposerDraft({ text, attachments: [] })

const withRegistry = Effect.fn('withRegistry')(function* (
  layerOf: (link: Effect.Success<ReturnType<typeof makeFakeHubLink>>) => Layer.Layer<never> | null,
) {
  const link = yield* makeFakeHubLink(bothPanes)
  const extra = layerOf(link)
  const registry = yield* Effect.acquireRelease(
    Effect.sync(() => appRegistry(extra === null ? link.layer : Layer.merge(link.layer, extra))),
    (made) =>
      Effect.sync(() => {
        made.dispose()
      }),
  )

  return { link, registry }
})

const panesSeen = (registry: AtomRegistry.AtomRegistry) => {
  const seen: Option.Option<readonly GlobalPaneId[]>[] = []

  registry.subscribe(
    draftPanesAtom,
    (panes) => {
      seen.push(Option.map(panes, (set) => Arr.fromIterable(set).toSorted()))
    },
    { immediate: true },
  )

  return seen
}

describe('drafts', () => {
  it.live('restores a draft kept on the device and names its pane', () =>
    Effect.gen(function* () {
      const { link, registry } = yield* withRegistry(() => null)
      const kept = typed('half a thought')

      yield* link.draftStore.seed(HashMap.make([FIRST, kept]))

      const seen = panesSeen(registry)

      yield* eventually(() => {
        expect(seen.at(-1)).toEqual(Option.some([FIRST_PANE]))
      })

      expect(registry.get(draftAtom(FIRST))).toEqual(kept)
      expect(registry.get(draftAtom(SECOND)).text).toBe('')
    }),
  )

  it.live('names no pane until the device has answered', () =>
    Effect.gen(function* () {
      const answered = yield* Latch.make(false)
      const { registry } = yield* withRegistry((link) =>
        DraftCache.layerOver({
          ...link.draftStore.store,
          keys: Effect.andThen(answered.await, link.draftStore.store.keys),
        }),
      )
      const seen = panesSeen(registry)

      expect(seen).toEqual([Option.none()])

      yield* answered.open
      yield* eventually(() => {
        expect(seen).toEqual([Option.none(), NO_PANES])
      })
    }),
  )

  it.live('changes the panes only when a draft turns empty or not, and keeps every edit', () =>
    Effect.gen(function* () {
      const { link, registry } = yield* withRegistry(() => null)
      const seen = panesSeen(registry)

      yield* eventually(() => {
        expect(seen).toEqual([NO_PANES])
      })

      registry.set(draftAtom(FIRST), typed('a'))
      registry.set(draftAtom(FIRST), typed('ab'))
      registry.set(draftAtom(FIRST), typed('abc'))

      expect(seen).toEqual([NO_PANES, Option.some([FIRST_PANE])])

      yield* eventually(() => {
        expect(
          Ref.getUnsafe(link.draftStore.entries).get(JSON.stringify(['draft', LAPTOP, FIRST.pane])),
        ).toEqual({ key: ['draft', LAPTOP, FIRST.pane], stored: { text: 'abc', attachments: [] } })
      })

      registry.set(draftAtom(FIRST), typed('   '))

      expect(seen).toEqual([NO_PANES, Option.some([FIRST_PANE]), NO_PANES])

      yield* eventually(() => {
        expect(Ref.getUnsafe(link.draftStore.entries).size).toBe(0)
      })
    }),
  )

  it.live('drops the draft of a pane that left the herd', () =>
    Effect.gen(function* () {
      const { link, registry } = yield* withRegistry(() => null)

      yield* link.draftStore.seed(HashMap.make([FIRST, typed('first')], [SECOND, typed('second')]))

      const seen = panesSeen(registry)

      yield* eventually(() => {
        expect(seen.at(-1)).toEqual(Option.some([FIRST_PANE, SECOND_PANE]))
      })

      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([machine(LAPTOP, [agent('w1:p2', 'idle')])])),
      )

      yield* eventually(() => {
        expect(seen.at(-1)).toEqual(Option.some([SECOND_PANE]))
        expect([...Ref.getUnsafe(link.draftStore.entries).keys()]).toEqual([
          JSON.stringify(['draft', LAPTOP, SECOND.pane]),
        ])
      })
    }),
  )

  it.live('keeps the drafts of a machine the herd has not heard from', () =>
    Effect.gen(function* () {
      const { link, registry } = yield* withRegistry(() => null)

      yield* link.draftStore.seed(HashMap.make([FIRST, typed('first')]))

      const seen = panesSeen(registry)

      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([machine(LAPTOP, [], { connection: 'offline' })])),
      )

      yield* eventually(() => {
        expect(seen.at(-1)).toEqual(Option.some([FIRST_PANE]))
      })
    }),
  )
})
