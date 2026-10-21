import { describe, expect, it } from '@effect/vitest'
import * as Cause from 'effect/Cause'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as AsyncResult from 'effect/reactivity/AsyncResult'

import { HarkReachedNoDevice } from '@crook/protocol/Hark'
import { connectionView } from '@crook/web/connection/ConnectionView'
import { COLD_START, HubLinkState, LinkStatus, QUIET_DIALING } from '@crook/web/rpc/HubLinkState'
import {
  hubStatus,
  settledFailure,
  testNotificationState,
} from '@crook/web/settings/SettingsLayout'

const statusOf = (status: LinkStatus) =>
  hubStatus(connectionView(new HubLinkState({ status, herd: Option.none() })))

const refused = new HarkReachedNoDevice()

describe('hubStatus', () => {
  it('reads connected while live, recovering or quietly resyncing', () => {
    expect(statusOf(LinkStatus.Live({ recovered: false }))).toEqual({
      tone: 'ok',
      label: 'connected',
    })
    expect(statusOf(LinkStatus.Live({ recovered: true })).label).toBe('connected')
    expect(statusOf(QUIET_DIALING).label).toBe('connected')
  })

  it('reads connecting on a cold start, and names every failure the banner names', () => {
    expect(statusOf(COLD_START)).toEqual({ tone: 'working', label: 'connecting' })
    expect(statusOf(LinkStatus.Unreachable())).toEqual({ tone: 'warn', label: 'unreachable' })
    expect(statusOf(LinkStatus.Offline())).toEqual({ tone: 'idle', label: 'offline' })
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

describe('settledFailure', () => {
  it('gives the refusal sentence once the call has settled, and nothing while it retries', () => {
    const failed = AsyncResult.fail(refused)

    expect(settledFailure(failed)).toEqual(Option.some(refused.message))
    expect(settledFailure(AsyncResult.waiting(failed))).toEqual(Option.none())
    expect(settledFailure(AsyncResult.success(undefined))).toEqual(Option.none())
    expect(settledFailure(AsyncResult.fromExit(Exit.failCause(Cause.die('a bug'))))).toEqual(
      Option.none(),
    )
  })
})
