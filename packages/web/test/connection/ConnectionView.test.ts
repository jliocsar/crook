import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'

import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import {
  allowsActions,
  connectionView,
  ConnectionView,
  dimsContent,
  isConnected,
  isVerified,
  noticeOf,
  syncedAtOf,
} from '@crook/web/connection/ConnectionView'
import {
  ANNOUNCED,
  COLD_START,
  EXPIRED,
  HubLinkState,
  LIVE,
  LOGGED_OUT,
  OFFLINE,
  PARKED,
  RECOVERED,
  REDIALING,
  RETURNING,
  UNREACHABLE,
} from '@crook/web/rpc/HubLinkState'
import type { LinkStatus } from '@crook/web/rpc/HubLinkState'

import { herd, START } from '../HerdFixtures.ts'

const cached = Option.some(new HerdSnapshot({ view: herd([]), syncedAt: START }))

const viewOf = (status: LinkStatus, withHerd = true) =>
  connectionView(new HubLinkState({ status, herd: withHerd ? cached : Option.none() }))

describe('connectionView', () => {
  it('reads a quiet redial as live: nothing said, nothing dimmed, controls open', () => {
    Arr.forEach([REDIALING, PARKED], (status) => {
      const view = viewOf(status)

      expect(view).toEqual(ConnectionView.Redialing())
      expect(noticeOf(view)).toEqual(Option.none())
      expect(dimsContent(view)).toBe(false)
      expect(allowsActions(view)).toBe(true)
      expect(isVerified(view)).toBe(true)
      expect(isConnected(view)).toBe(false)
    })
  })

  it('shows a cold start with a cached herd as it was, without saying anything yet', () => {
    const view = viewOf(COLD_START)

    expect(view).toEqual(ConnectionView.Resuming())
    expect(dimsContent(view)).toBe(false)
    expect(noticeOf(view)).toEqual(Option.none())
    expect(allowsActions(view)).toBe(true)
    expect(isVerified(view)).toBe(false)
  })

  it('starts with nothing known when there is no herd yet', () => {
    expect(viewOf(COLD_START, false)).toEqual(ConnectionView.Starting())
  })

  it('says syncing or connecting once a dial has taken a while, without dimming', () => {
    expect(noticeOf(viewOf(ANNOUNCED))).toEqual(Option.some('syncing'))
    expect(noticeOf(viewOf(ANNOUNCED, false))).toEqual(Option.some('connecting'))
    expect(dimsContent(viewOf(ANNOUNCED))).toBe(false)
    expect(allowsActions(viewOf(ANNOUNCED))).toBe(true)
  })

  it('stays dimmed and closed from offline until the herd is back', () => {
    expect(noticeOf(viewOf(RETURNING))).toEqual(Option.some('syncing'))
    expect(noticeOf(viewOf(RETURNING, false))).toEqual(Option.some('connecting'))
    expect(dimsContent(viewOf(RETURNING))).toBe(true)
    expect(allowsActions(viewOf(RETURNING))).toBe(false)
  })

  it('lets a live link act', () => {
    expect(allowsActions(viewOf(LIVE))).toBe(true)
    expect(isConnected(viewOf(LIVE))).toBe(true)
    expect(noticeOf(viewOf(LIVE))).toEqual(Option.none())
  })

  it('says so when the hub is unreachable or the phone is offline, with the last sync', () => {
    expect(noticeOf(viewOf(UNREACHABLE))).toEqual(Option.some('unreachable'))
    expect(noticeOf(viewOf(OFFLINE))).toEqual(Option.some('offline'))
    expect(allowsActions(viewOf(UNREACHABLE))).toBe(false)
    expect(allowsActions(viewOf(OFFLINE))).toBe(false)
    expect(syncedAtOf(viewOf(OFFLINE))).toEqual(Option.some(START))
    expect(syncedAtOf(viewOf(UNREACHABLE))).toEqual(Option.some(START))
  })

  it('carries a sync time only where it is shown, so a herd update changes no live view', () => {
    expect(viewOf(LIVE)).toEqual(ConnectionView.Live())
    expect(viewOf(RECOVERED)).toEqual(ConnectionView.Recovered())
    expect(syncedAtOf(viewOf(LIVE))).toEqual(Option.none())
  })

  it('says back online after a recovery and nothing when the session ended', () => {
    expect(noticeOf(viewOf(RECOVERED))).toEqual(Option.some('recovered'))
    expect(noticeOf(viewOf(EXPIRED))).toEqual(Option.none())
    expect(noticeOf(viewOf(LOGGED_OUT, false))).toEqual(Option.none())
    expect(allowsActions(viewOf(LOGGED_OUT, false))).toBe(false)
  })
})
