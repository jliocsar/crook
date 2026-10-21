import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'

import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { connectionView } from '@crook/web/connection/ConnectionView'
import { COLD_START, HubLinkState, LinkStatus, QUIET_DIALING } from '@crook/web/rpc/HubLinkState'

import { herd, START } from '../HerdFixtures.ts'

const cached = Option.some(new HerdSnapshot({ view: herd([]), syncedAt: START }))

const viewOf = (status: LinkStatus, withHerd = true) =>
  connectionView(new HubLinkState({ status, herd: withHerd ? cached : Option.none() }))

describe('connectionView', () => {
  it('keeps a quick resync silent, readable and looking the same, yet refuses hub calls', () => {
    const view = viewOf(QUIET_DIALING)

    expect(view.notice).toEqual(Option.none())
    expect(view.stale).toBe(false)
    expect(view.controlsEnabled).toBe(true)
    expect(view.canAct).toBe(false)
  })

  it('dims a cached herd on a cold start at once, and waits the second to say so', () => {
    const view = viewOf(COLD_START)

    expect(view.stale).toBe(true)
    expect(view.notice).toEqual(Option.none())
    expect(view.controlsEnabled).toBe(false)
  })

  it('says syncing over a cached herd and connecting without one', () => {
    const announced = LinkStatus.Dialing({ announced: true, afterFailure: false, coldStart: false })

    expect(viewOf(announced).notice).toEqual(Option.some('syncing'))
    expect(viewOf(announced, false).notice).toEqual(Option.some('connecting'))
    expect(viewOf(announced).stale).toBe(true)
    expect(viewOf(announced).controlsEnabled).toBe(false)
  })

  it('lets hub actions through only while live', () => {
    expect(viewOf(LinkStatus.Live({ recovered: false })).canAct).toBe(true)
    expect(viewOf(LinkStatus.Unreachable()).canAct).toBe(false)
    expect(viewOf(LinkStatus.Unreachable()).controlsEnabled).toBe(false)
    expect(viewOf(LinkStatus.Offline()).canAct).toBe(false)
  })

  it('tells the hub being unreachable apart from the phone being offline', () => {
    expect(viewOf(LinkStatus.Unreachable()).notice).toEqual(Option.some('unreachable'))
    expect(viewOf(LinkStatus.Offline()).notice).toEqual(Option.some('offline'))
    expect(viewOf(LinkStatus.Offline()).syncedAt).toEqual(Option.some(START))
  })

  it('says back online after a failure, and flags an expired session', () => {
    expect(viewOf(LinkStatus.Live({ recovered: true })).notice).toEqual(Option.some('recovered'))
    expect(viewOf(LinkStatus.Expired()).expired).toBe(true)
    expect(viewOf(LinkStatus.Expired()).notice).toEqual(Option.none())
  })

  it('flags a logout apart from an expired session, with every hub action off', () => {
    const view = viewOf(LinkStatus.LoggedOut())

    expect(view.loggedOut).toBe(true)
    expect(view.expired).toBe(false)
    expect(view.canAct).toBe(false)
    expect(view.notice).toEqual(Option.none())
  })
})
