import type * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Stream from 'effect/Stream'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { HerdView } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { HerdCache } from '@crook/web/cache/HerdCache'
import type { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { HubConnection } from '@crook/web/rpc/HubConnection'
import type { HubCallFailed } from '@crook/web/rpc/HubConnection'
import { HubLink } from '@crook/web/rpc/HubLink'
import type { HubLinkState } from '@crook/web/rpc/HubLinkState'
import { PageSignals } from '@crook/web/rpc/PageSignals'
import { SessionCheck } from '@crook/web/rpc/SessionCheck'

export interface FakeSession {
  readonly views: Queue.Queue<HerdView, HubCallFailed | Cause.Done>
}

export interface SeenCall {
  readonly machine: MachineId
  readonly pane: PaneId
}

export const makeFakeBrowser = Effect.fn('makeFakeBrowser')(function* (
  cached: Option.Option<HerdSnapshot>,
) {
  const sessions = yield* Queue.unbounded<FakeSession>()
  const opened = yield* Ref.make(0)
  const closed = yield* Ref.make(0)
  const seen = yield* Ref.make<readonly SeenCall[]>([])
  const saved = yield* Ref.make(cached)
  const visible = yield* SubscriptionRef.make(true)
  const online = yield* SubscriptionRef.make(true)
  const expired = yield* Ref.make(false)

  const open = Effect.gen(function* () {
    const views = yield* Queue.unbounded<HerdView, HubCallFailed | Cause.Done>()

    yield* Ref.update(opened, (count) => count + 1)
    yield* Effect.addFinalizer(() => Ref.update(closed, (count) => count + 1))
    yield* Queue.offer(sessions, { views })

    return {
      watchHerd: Stream.fromQueue(views),
      markSeen: (machine: MachineId, pane: PaneId) =>
        Ref.update(seen, (calls) => [...calls, { machine, pane }]),
    }
  })

  const layer = Layer.mergeAll(
    Layer.succeed(HubConnection, HubConnection.of({ open })),
    Layer.succeed(
      HerdCache,
      HerdCache.of({
        load: Ref.get(saved),
        save: (snapshot) => Ref.set(saved, Option.some(snapshot)),
      }),
    ),
    Layer.succeed(
      PageSignals,
      PageSignals.of({
        visible: SubscriptionRef.changes(visible),
        online: SubscriptionRef.changes(online),
      }),
    ),
    Layer.succeed(SessionCheck, SessionCheck.of({ expired: Ref.get(expired) })),
  )

  return { layer, sessions, opened, closed, seen, saved, visible, online, expired }
})

export const makeFakeHubLink = Effect.fn('makeFakeHubLink')(function* (initial: HubLinkState) {
  const state = yield* SubscriptionRef.make(initial)
  const seen = yield* Ref.make<readonly SeenCall[]>([])
  const resyncs = yield* Ref.make(0)

  const layer = Layer.succeed(
    HubLink,
    HubLink.of({
      changes: SubscriptionRef.changes(state),
      resync: Ref.update(resyncs, (count) => count + 1),
      markSeen: (machine, pane) => Ref.update(seen, (calls) => [...calls, { machine, pane }]),
    }),
  )

  return { layer, state, seen, resyncs }
})

export const dropSession = (session: FakeSession, error: HubCallFailed) =>
  Queue.fail(session.views, error)
