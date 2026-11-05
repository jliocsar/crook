import { render, waitFor } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as SubscriptionRef from 'effect/SubscriptionRef'

import type { AgentRow } from '@crook/domain/AgentRow'
import type { HubLinkState } from '@crook/web/rpc/HubLinkState'

import { appRegistry, appRouter, AppTree, liveWith } from './AppWiring.tsx'
import { herd, LAPTOP, machine } from './HerdFixtures.ts'
import { makeFakeHubLink } from './HubFakes.ts'

const REDIALING_DOCK = '[data-machine="presence"][data-state="Redialing"]'

export const renderApp = Effect.fn('renderApp')(function* (path: string, initial: HubLinkState) {
  const link = yield* makeFakeHubLink(initial)
  const router = appRouter(path)
  const { registry } = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const made = appRegistry(link.layer)
      const rendered = render(<AppTree registry={made} router={router} />)

      return { registry: made, rendered }
    }),
    ({ registry: made, rendered }) =>
      Effect.sync(() => {
        rendered.unmount()
        made.dispose()
      }),
  )

  yield* Effect.promise(() => router.load())

  return { router, link, registry }
})

export const machineRedials = Effect.fn('machineRedials')(function* (
  link: { readonly state: SubscriptionRef.SubscriptionRef<HubLinkState> },
  rows: readonly AgentRow[],
) {
  yield* SubscriptionRef.set(
    link.state,
    liveWith(herd([machine(LAPTOP, rows, { connection: 'reconnecting' })])),
  )
  yield* Effect.promise(() =>
    waitFor(() => {
      if (document.querySelector(REDIALING_DOCK) === null) {
        throw new Error('The dock has not started waiting for the machine.')
      }
    }),
  )
})

export const machineGoesAway = Effect.fn('machineGoesAway')(function* (
  link: { readonly state: SubscriptionRef.SubscriptionRef<HubLinkState> },
  rows: readonly AgentRow[],
) {
  yield* machineRedials(link, rows)
  yield* SubscriptionRef.set(
    link.state,
    liveWith(herd([machine(LAPTOP, rows, { connection: 'offline' })])),
  )
})

export { liveWith, stateWith } from './AppWiring.tsx'
