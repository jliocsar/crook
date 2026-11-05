import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'

import { HarkReachedNoDevice } from '@crook/protocol/Hark'
import { connectionView } from '@crook/web/connection/ConnectionView'
import {
  COLD_START,
  HubLinkState,
  LIVE,
  OFFLINE,
  RECOVERED,
  REDIALING,
  UNREACHABLE,
} from '@crook/web/rpc/HubLinkState'
import type { LinkStatus } from '@crook/web/rpc/HubLinkState'
import { hubStatus, testNotificationState } from '@crook/web/settings/SettingsLayout'

const statusOf = (status: LinkStatus) =>
  hubStatus(connectionView(new HubLinkState({ status, herd: Option.none() })))

const refused = new HarkReachedNoDevice()

describe('hubStatus', () => {
  it('reads connected while live, recovering or quietly resyncing', () => {
    expect(statusOf(LIVE)).toEqual({
      tone: 'ok',
      label: 'connected',
    })
    expect(statusOf(RECOVERED).label).toBe('connected')
    expect(statusOf(REDIALING).label).toBe('connected')
  })

  it('reads connecting on a cold start, and names every failure the banner names', () => {
    expect(statusOf(COLD_START)).toEqual({ tone: 'working', label: 'connecting' })
    expect(statusOf(UNREACHABLE)).toEqual({ tone: 'warn', label: 'unreachable' })
    expect(statusOf(OFFLINE)).toEqual({ tone: 'idle', label: 'offline' })
  })
})

describe('testNotificationState', () => {
  it('is idle until asked, sending while waiting, sent on success and idle after a refusal', () => {
    expect(testNotificationState(AsyncResult.initial())).toBe('idle')
    expect(testNotificationState(AsyncResult.initial(true))).toBe('sending')
    expect(testNotificationState(AsyncResult.success(undefined))).toBe('sent')
    expect(testNotificationState(AsyncResult.fail(refused))).toBe('idle')
  })
})
