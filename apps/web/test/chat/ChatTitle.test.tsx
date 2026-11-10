import { describe, expect, it } from '@effect/vitest'
import { screen, within } from '@testing-library/react'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as SubscriptionRef from 'effect/SubscriptionRef'
import { beforeEach } from 'vitest'

import { COLD_START } from '@crook/web/rpc/HubLinkState'

import { liveWith, renderApp, stateWith } from '../AppRender.tsx'
import { eventually, findByRole } from '../Dom.ts'
import { agent, herd, LAPTOP, machine } from '../HerdFixtures.ts'
import { stubMediaQueries } from '../MediaQueries.ts'

const CHAT = '/m/laptop/p/w1:p1'
const TITLE_BEFORE_THE_HERD = 'Chat'

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
})

describe('a chat title', () => {
  it.effect('is never the pane id, and waits for the link before it shows at all', () =>
    Effect.gen(function* () {
      const { link } = yield* renderApp(
        CHAT,
        stateWith(COLD_START, Option.none()),
        (fake) => fake.stateReads.close,
      )
      const title = yield* findByRole('heading', TITLE_BEFORE_THE_HERD)

      expect(within(title).getByText(TITLE_BEFORE_THE_HERD).className).toContain('invisible')
      expect(screen.queryByText('w1:p1')).toBeNull()

      yield* link.stateReads.open
      yield* eventually(() => {
        expect(screen.getByRole('heading', { name: TITLE_BEFORE_THE_HERD }).innerHTML).toBe(
          TITLE_BEFORE_THE_HERD,
        )
      })

      yield* SubscriptionRef.set(
        link.state,
        liveWith(herd([machine(LAPTOP, [agent('w1:p1', 'idle', { title: 'Port the herd' })])])),
      )
      yield* findByRole('heading', 'Port the herd')
    }),
  )
})
