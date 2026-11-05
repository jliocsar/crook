import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { beforeEach } from 'vitest'

import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubLinkState } from '@crook/web/rpc/HubLinkState'

import { liveWith, renderApp } from '../AppRender.tsx'
import { eventually, wait } from '../Dom.ts'
import { agent, DESK, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'
import { RENDER_COUNTS } from '../RenderCounter.ts'

const WATCHED = ['HubGate', 'Shell', 'ToastHost', 'AgentActions']
const HERD_UPDATES = 10
const SETTLE_MS = 30

const laptop = machine(LAPTOP, [agent('w1:p1', 'idle', { title: 'Stays as it is' })])
const deskAt = (secondsAgo: number) =>
  machine(DESK, [agent('w2:p1', 'working', { title: 'On the other machine', secondsAgo })])
const counted = () => Arr.map(WATCHED, (name) => RENDER_COUNTS.get(name) ?? 0)
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
          SubscriptionRef.update(
            link.state,
            (current) =>
              new HubLinkState({
                status: current.status,
                herd: Option.some(
                  new HerdSnapshot({
                    view: herd([laptop, deskAt(update)]),
                    syncedAt: DateTime.add(START, { seconds: update }),
                  }),
                ),
              }),
          ).pipe(Effect.andThen(wait(SETTLE_MS))),
        { discard: true },
      )

      expect(subtract(counted(), before)).toEqual([0, 0, 0, 0])
    }),
  )
})
