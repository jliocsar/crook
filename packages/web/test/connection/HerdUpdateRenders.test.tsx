import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { screen } from '@testing-library/react'
import { beforeEach } from 'vitest'

import { PaneId } from '@crook/domain/Ids'
import { PaneTranscript } from '@crook/domain/Transcript'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubLinkState } from '@crook/web/rpc/HubLinkState'

import { liveWith, renderApp } from '../AppRender.tsx'
import { eventually, wait } from '../Dom.ts'
import { agent, DESK, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { RENDER_COUNTS } from '../RenderCounter.ts'
import { phoneViewport } from '../ThreadRender.tsx'
import { chunk, opened, prompt } from '../TranscriptFixtures.ts'

const WATCHED = ['HubGate', 'Shell', 'ToastHost', 'AgentActions']
const WATCHED_IN_CHAT = ['ChatBody', 'ChatDock']
const HERD_UPDATES = 10
const SETTLE_MS = 30
const CHAT = '/m/laptop/p/w1:p1'

const laptop = machine(LAPTOP, [agent('w1:p1', 'idle', { title: 'Stays as it is' })])
const deskAt = (secondsAgo: number) =>
  machine(DESK, [agent('w2:p1', 'working', { title: 'On the other machine', secondsAgo })])
const countedOf = (names: readonly string[]) =>
  Arr.map(names, (name) => RENDER_COUNTS.get(name) ?? 0)
const counted = () => countedOf(WATCHED)
const setsHerd = (
  link: { readonly state: SubscriptionRef.SubscriptionRef<HubLinkState> },
  machines: Parameters<typeof herd>[0],
  update: number,
) =>
  SubscriptionRef.update(
    link.state,
    (current) =>
      new HubLinkState({
        status: current.status,
        herd: Option.some(
          new HerdSnapshot({
            view: herd(machines),
            syncedAt: DateTime.add(START, { seconds: update }),
          }),
        ),
      }),
  )
const subtract = (after: readonly number[], before: readonly number[]) =>
  Arr.zipWith(after, before, (later, earlier) => later - earlier)

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
})

describe('a herd update from another machine', () => {
  it.effect('renders nothing above the screens', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp('/', liveWith(herd([laptop, deskAt(0)])))

      yield* eventually(() => {
        expect(RENDER_COUNTS.get('HubGate') ?? 0).toBeGreaterThan(0)
      })
      yield* wait(SETTLE_MS)

      const before = counted()

      yield* Effect.forEach(
        Arr.range(1, HERD_UPDATES),
        (update) =>
          setsHerd(link, [laptop, deskAt(update)], update).pipe(Effect.andThen(wait(SETTLE_MS))),
        { discard: true },
      )

      expect(subtract(counted(), before)).toEqual([0, 0, 0, 0])
    }),
  )

  it.effect(
    'renders nothing of an open chat while its agent works, until its own row changes',
    () =>
      Effect.gen(function* () {
        phoneViewport()

        const workingLaptop = machine(LAPTOP, [
          agent('w1:p1', 'working', { title: 'Stays as it is' }),
        ])
        const { link } = yield* renderApp(CHAT, liveWith(herd([workingLaptop, deskAt(0)])))
        const transcript = yield* link.transcriptFor(
          new PaneTranscript({ pane: PaneId.make('w1:p1') }),
        )

        yield* Queue.offerAll(transcript, [opened(), chunk(0, 10, [prompt(0, 'Fix the herd')])])
        yield* Effect.promise(() => screen.findByText('Fix the herd'))
        yield* wait(SETTLE_MS)

        const before = countedOf(WATCHED_IN_CHAT)

        yield* Effect.forEach(
          Arr.range(1, HERD_UPDATES),
          (update) =>
            setsHerd(link, [workingLaptop, deskAt(update)], update).pipe(
              Effect.andThen(wait(SETTLE_MS)),
            ),
          { discard: true },
        )

        expect(subtract(countedOf(WATCHED_IN_CHAT), before)).toEqual([0, 0])

        yield* setsHerd(
          link,
          [machine(LAPTOP, [agent('w1:p1', 'idle', { title: 'Stays as it is' })]), deskAt(11)],
          HERD_UPDATES + 1,
        )
        yield* eventually(() => {
          expect(subtract(countedOf(WATCHED_IN_CHAT), before)[0]).toBeGreaterThan(0)
        })
      }),
  )
})
