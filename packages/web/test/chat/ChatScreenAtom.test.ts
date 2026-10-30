import { describe, expect, it } from '@effect/vitest'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { vi } from 'vitest'

import { PaneId } from '@crook/domain/Ids'
import { chatScreenAtom } from '@crook/web/atoms/Chat'
import { pendingActionAtom, PendingActionKey } from '@crook/web/atoms/Commands'
import { canActAtom, staleAtom } from '@crook/web/atoms/Connection'
import { OpenedAgent } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'
import { mintIdempotencyKey } from '@crook/web/rpc/IdempotencyKeys'

import { liveWith } from '../AppRender.tsx'
import { agent, DESK, herd, LAPTOP, machine } from '../HerdFixtures.ts'
import { makeFakeHubLink } from '../HubFakes.ts'

const PANE = PaneId.make('w1:p1')

const herdWith = (deskSeq: number, laptopStatus: 'working' | 'idle' = 'working') =>
  liveWith(
    herd([
      machine(LAPTOP, [agent('w1:p1', laptopStatus)]),
      machine(DESK, [agent('w1:p1', deskSeq % 2 === 0 ? 'idle' : 'working', { seq: deskSeq })]),
    ]),
  )

const watched = Effect.fn('watched')(function* () {
  const link = yield* makeFakeHubLink(herdWith(1))
  const registry = yield* Effect.acquireRelease(
    Effect.sync(() =>
      AtomRegistry.make({ initialValues: [Atom.initialValue(hubRuntime.layer, link.layer)] }),
    ),
    (made) => Effect.sync(() => made.dispose()),
  )
  const models: ChatScreenModel[] = []
  const wakes = { canAct: 0, stale: 0, pendingAction: 0 }

  yield* Effect.acquireRelease(
    Effect.sync(() => [
      registry.subscribe(
        chatScreenAtom(new OpenedAgent({ machine: LAPTOP, pane: PANE })),
        (model) => {
          models.push(model)
        },
        { immediate: true },
      ),
      registry.subscribe(
        canActAtom,
        () => {
          wakes.canAct += 1
        },
        { immediate: true },
      ),
      registry.subscribe(
        staleAtom,
        () => {
          wakes.stale += 1
        },
        { immediate: true },
      ),
      registry.subscribe(
        pendingActionAtom(new PendingActionKey({ key: mintIdempotencyKey(), machine: LAPTOP })),
        () => {
          wakes.pendingAction += 1
        },
        { immediate: true },
      ),
    ]),
    (unsubscribes) =>
      Effect.sync(() => {
        for (const unsubscribe of unsubscribes) {
          unsubscribe()
        }
      }),
  )
  yield* Effect.promise(() =>
    vi.waitFor(() => {
      expect(models.at(-1)?.presence).toBe('live')
    }),
  )

  return { link, models, wakes }
})

describe('chatScreenAtom', () => {
  it.live('wakes nothing in the chat when only another machine changes', () =>
    Effect.gen(function* () {
      const { link, models, wakes } = yield* watched()
      const shown = models.length
      const before = { ...wakes }

      yield* SubscriptionRef.set(link.state, herdWith(2))
      yield* SubscriptionRef.set(link.state, herdWith(3))
      yield* SubscriptionRef.set(link.state, herdWith(4, 'idle'))
      yield* Effect.promise(() =>
        vi.waitFor(() => {
          expect(models.length).toBe(shown + 1)
        }),
      )

      yield* Effect.sleep(Duration.zero)

      expect(models.length).toBe(shown + 1)
      expect(wakes).toStrictEqual(before)
      expect(models.at(-1)?.presence).toBe('live')
    }).pipe(Effect.scoped),
  )
})
