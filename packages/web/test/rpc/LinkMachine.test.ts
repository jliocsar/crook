import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'

import { walk } from '@crook/web/machine/Walk'
import {
  ATTEMPT_BEGAN,
  COLD_START,
  CONNECTION_DROPPED,
  HERD_RECEIVED,
  linkMachine,
  LIVE,
  NOTICE_DELAY_PASSED,
  OFFLINE,
  PAGE_HIDDEN,
  PARKED,
  RECOVERED,
  RECOVERED_NOTICE_ENDED,
  REDIALING,
  RETURNING,
  ANNOUNCED,
} from '@crook/web/rpc/HubLinkState'
import type { LinkEvent, LinkStatus } from '@crook/web/rpc/HubLinkState'

import { linkWalk } from '../../charts/LinkWalk.ts'

const after = (start: LinkStatus, events: readonly LinkEvent[]): LinkStatus =>
  Arr.reduce(events, start, (status, event) => linkMachine.transition(status, event)[0])

describe('the link machine', () => {
  it('walks clean: every state reached, nothing trapped, nothing contradictory', () => {
    const walked = walk(linkWalk)

    expect(walked.findings).toEqual([])
    expect(walked.states).toHaveLength(11)
  })

  it('goes hidden and back without ever reading as live with no connection', () => {
    expect(after(LIVE, [CONNECTION_DROPPED, PAGE_HIDDEN])).toEqual(PARKED)
    expect(after(PARKED, [ATTEMPT_BEGAN])).toEqual(REDIALING)
    expect(after(PARKED, [ATTEMPT_BEGAN, HERD_RECEIVED])).toEqual(LIVE)
  })

  it('announces a cold start and a redial only after the delay', () => {
    expect(after(COLD_START, [ATTEMPT_BEGAN])).toEqual(COLD_START)
    expect(after(COLD_START, [ATTEMPT_BEGAN, NOTICE_DELAY_PASSED])).toEqual(ANNOUNCED)
    expect(after(LIVE, [CONNECTION_DROPPED, ATTEMPT_BEGAN, NOTICE_DELAY_PASSED])).toEqual(ANNOUNCED)
  })

  it('recovers from offline through a notice that ends on its own', () => {
    const [recovered, commands] = linkMachine.transition(RETURNING, HERD_RECEIVED)

    expect(after(OFFLINE, [ATTEMPT_BEGAN])).toEqual(RETURNING)
    expect(recovered).toEqual(RECOVERED)
    expect(commands).toEqual(['StartRecoveredTimer'])
    expect(after(RECOVERED, [RECOVERED_NOTICE_ENDED])).toEqual(LIVE)
  })

  it('starts the notice timer on every dial that says nothing yet', () => {
    expect(linkMachine.transition(COLD_START, ATTEMPT_BEGAN)[1]).toEqual(['StartNoticeTimer'])
    expect(linkMachine.transition(LIVE, ATTEMPT_BEGAN)[1]).toEqual(['StartNoticeTimer'])
    expect(linkMachine.transition(OFFLINE, ATTEMPT_BEGAN)[1]).toEqual([])
  })
})
