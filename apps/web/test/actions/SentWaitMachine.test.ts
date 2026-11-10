import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'
import * as AtomRegistry from 'effect/reactivity/AtomRegistry'

import {
  answered,
  boundEnded,
  NOT_SENT,
  SETTLED,
  sentWaitMachine,
  SentWaitState,
} from '@crook/web/actions/SentWaitMachine'
import type { SentWaitEvent } from '@crook/web/actions/SentWaitMachine'
import { ActionProgress, progressOf } from '@crook/web/atoms/ActionProgress'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { boundedProgressAtom, sentWaitEventOf, withSentWait } from '@crook/web/atoms/SentBound'
import { walk } from '@crook/state-machine/Walk'

import { sentWaitWalk } from '../../charts/SentWaitWalk.ts'
import { liveWith } from '../AppWiring.tsx'
import { herd } from '../HerdFixtures.ts'
import { makeFakeHubLink } from '../HubFakes.ts'

const AT = 1000
const LATER = 2000
const LONG_AGO = 0
const BOUND_MS = 40
const SETTLE_MS = 120
const RECEIPT = 'receipt'

const after = (events: readonly SentWaitEvent[]): SentWaitState =>
  Arr.reduce(
    events,
    sentWaitMachine.initial,
    (state, event) => sentWaitMachine.transition(state, event)[0],
  )

describe('the sent-wait machine', () => {
  it('walks clean: every state reached, nothing trapped, a stale wait changes nothing', () => {
    expect(walk(sentWaitWalk).findings).toEqual([])
  })

  it('gives up on an answer the herd never shows', () => {
    expect(SentWaitState.guards.Awaiting(after([answered(AT)]))).toBe(true)
    expect(SentWaitState.guards.Unconfirmed(after([answered(AT), boundEnded(AT)]))).toBe(true)
  })

  it('still settles when the herd shows it after giving up', () => {
    expect(after([answered(AT), boundEnded(AT), SETTLED])).toEqual(NOT_SENT)
  })

  it('drops the end of a wait for an answer it has moved past', () => {
    expect(after([answered(AT), answered(LATER), boundEnded(AT)])).toEqual(
      SentWaitState.cases.Awaiting.make({ answeredAt: LATER }),
    )
  })

  it('starts one timer per answer and none for the same answer read again', () => {
    const [waiting, first] = sentWaitMachine.transition(NOT_SENT, answered(AT))
    const [, again] = sentWaitMachine.transition(waiting, answered(AT))

    expect(first.length).toBe(1)
    expect(again.length).toBe(0)
  })
})

describe('reading a command through its wait', () => {
  const sent = ActionProgress.Sent({ receipt: RECEIPT })
  const gaveUp = SentWaitState.cases.Unconfirmed.make({ answeredAt: AT })

  it('turns Sent into Unconfirmed once the wait gave up, and nothing else', () => {
    expect(withSentWait(sent, gaveUp)).toEqual(ActionProgress.Unconfirmed({ receipt: RECEIPT }))
    expect(withSentWait(sent, NOT_SENT)).toEqual(sent)
    expect(withSentWait(ActionProgress.Done({ receipt: RECEIPT }), gaveUp)).toEqual(
      ActionProgress.Done({ receipt: RECEIPT }),
    )
  })

  it('names the wait after the answer that started it', () => {
    const result = AsyncResult.success(RECEIPT, { timestamp: AT })

    expect(sentWaitEventOf(sent, result)).toEqual(answered(AT))
    expect(sentWaitEventOf(ActionProgress.Done({ receipt: RECEIPT }), result)).toEqual(SETTLED)
    expect(sentWaitEventOf(ActionProgress.Sending(), AsyncResult.initial(true))).toEqual(SETTLED)
  })
})

describe('a bounded progress atom', () => {
  const registered = Effect.fn('registered')(function* () {
    const link = yield* makeFakeHubLink(liveWith(herd([])))

    return yield* Effect.acquireRelease(
      Effect.sync(() =>
        AtomRegistry.make({ initialValues: [Atom.initialValue(hubRuntime.layer, link.layer)] }),
      ),
      (made) => Effect.sync(() => made.dispose()),
    )
  })

  const driven = (
    shown: Atom.Atom<boolean>,
    result = Atom.make(AsyncResult.success(RECEIPT)),
    bound = Duration.millis(BOUND_MS),
  ) =>
    boundedProgressAtom({
      result,
      progress: (get) => progressOf(get(result), () => get(shown)),
      bound: Effect.succeed(bound),
    })

  it.live('holds Sent until its bound, and turns Done when the herd shows it late', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* registered()
        const shown = Atom.make(false)
        const progress = driven(shown)
        const seen: ActionProgress<string>[] = []
        const unsubscribe = registry.subscribe(
          progress,
          (value) => {
            seen.push(value)
          },
          { immediate: true },
        )

        expect(seen).toEqual([ActionProgress.Sent({ receipt: RECEIPT })])

        yield* Effect.sleep(Duration.millis(SETTLE_MS))

        expect(seen.at(-1)).toEqual(ActionProgress.Unconfirmed({ receipt: RECEIPT }))

        registry.set(shown, true)

        expect(seen.at(-1)).toEqual(ActionProgress.Done({ receipt: RECEIPT }))

        unsubscribe()
      }),
    ),
  )

  it.live('counts from the answer, so a screen coming back to an old answer waits no longer', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* registered()
        const progress = driven(
          Atom.make(false),
          Atom.make(AsyncResult.success(RECEIPT, { timestamp: LONG_AGO })),
          Duration.seconds(30),
        )
        const seen: ActionProgress<string>[] = []
        const unsubscribe = registry.subscribe(
          progress,
          (value) => {
            seen.push(value)
          },
          { immediate: true },
        )

        yield* Effect.sleep(Duration.millis(SETTLE_MS))

        expect(seen.at(-1)).toEqual(ActionProgress.Unconfirmed({ receipt: RECEIPT }))

        unsubscribe()
      }),
    ),
  )

  it.live('never gives up on what the herd shows before the bound', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* registered()
        const shown = Atom.make(false)
        const progress = driven(shown)
        const seen: ActionProgress<string>[] = []
        const unsubscribe = registry.subscribe(
          progress,
          (value) => {
            seen.push(value)
          },
          { immediate: true },
        )

        registry.set(shown, true)

        yield* Effect.sleep(Duration.millis(SETTLE_MS))

        expect(seen).toEqual([
          ActionProgress.Sent({ receipt: RECEIPT }),
          ActionProgress.Done({ receipt: RECEIPT }),
        ])

        unsubscribe()
      }),
    ),
  )
})
