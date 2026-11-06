import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import type { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { to } from '@crook/state-machine/Machine'
import type { Machine, Step } from '@crook/state-machine/Machine'

export type LinkCommand = 'StartNoticeTimer' | 'StartRecoveredTimer'

type LinkStep = Step<LinkStatus, LinkCommand>

export const LinkStatus = Schema.TaggedUnion({
  ColdStart: {},
  Redialing: {},
  Parked: {},
  Announced: {},
  Returning: {},
  Live: {},
  Recovered: {},
  Unreachable: {},
  Offline: {},
  Expired: {},
  LoggedOut: {},
})
export type LinkStatus = typeof LinkStatus.Type

export const LinkEvent = Schema.TaggedUnion({
  AttemptBegan: {},
  NoticeDelayPassed: {},
  HerdReceived: {},
  RecoveredNoticeEnded: {},
  ConnectionDropped: {},
  DialRefused: {},
  SessionExpired: {},
  WentOffline: {},
  PageHidden: {},
  LoggedOutConfirmed: {},
})
export type LinkEvent = typeof LinkEvent.Type

export const COLD_START = LinkStatus.cases.ColdStart.make({})
export const REDIALING = LinkStatus.cases.Redialing.make({})
export const PARKED = LinkStatus.cases.Parked.make({})
export const ANNOUNCED = LinkStatus.cases.Announced.make({})
export const RETURNING = LinkStatus.cases.Returning.make({})
export const LIVE = LinkStatus.cases.Live.make({})
export const RECOVERED = LinkStatus.cases.Recovered.make({})
export const UNREACHABLE = LinkStatus.cases.Unreachable.make({})
export const OFFLINE = LinkStatus.cases.Offline.make({})
export const EXPIRED = LinkStatus.cases.Expired.make({})
export const LOGGED_OUT = LinkStatus.cases.LoggedOut.make({})
export const ATTEMPT_BEGAN = LinkEvent.cases.AttemptBegan.make({})
export const NOTICE_DELAY_PASSED = LinkEvent.cases.NoticeDelayPassed.make({})
export const HERD_RECEIVED = LinkEvent.cases.HerdReceived.make({})
export const RECOVERED_NOTICE_ENDED = LinkEvent.cases.RecoveredNoticeEnded.make({})
export const CONNECTION_DROPPED = LinkEvent.cases.ConnectionDropped.make({})
export const DIAL_REFUSED = LinkEvent.cases.DialRefused.make({})
export const SESSION_EXPIRED = LinkEvent.cases.SessionExpired.make({})
export const WENT_OFFLINE = LinkEvent.cases.WentOffline.make({})
export const PAGE_HIDDEN = LinkEvent.cases.PageHidden.make({})
export const LOGGED_OUT_CONFIRMED = LinkEvent.cases.LoggedOutConfirmed.make({})

export class HubLinkState extends Data.Class<{
  readonly status: LinkStatus
  readonly herd: Option.Option<HerdSnapshot>
}> {}

const isLoggedOut = LinkStatus.guards.LoggedOut
const isAnswering = LinkStatus.isAnyOf(['Live', 'Recovered'])
const hasGivenUp = LinkStatus.isAnyOf(['Unreachable', 'Offline', 'Expired', 'LoggedOut'])

const dialing = (status: LinkStatus): LinkStep => [status, ['StartNoticeTimer']]

const linkTransition = (status: LinkStatus, event: LinkEvent): LinkStep =>
  isLoggedOut(status)
    ? to(status)
    : Match.value(event).pipe(
        Match.withReturnType<LinkStep>(),
        Match.tagsExhaustive({
          AttemptBegan: () =>
            Match.value(status).pipe(
              Match.withReturnType<LinkStep>(),
              Match.tags({
                ColdStart: () => dialing(COLD_START),
                Redialing: () => dialing(REDIALING),
                Parked: () => dialing(REDIALING),
                Live: () => dialing(REDIALING),
                Recovered: () => dialing(REDIALING),
                Offline: () => to(RETURNING),
              }),
              Match.orElse(() => to(status)),
            ),
          NoticeDelayPassed: () =>
            to(LinkStatus.isAnyOf(['ColdStart', 'Redialing'])(status) ? ANNOUNCED : status),
          HerdReceived: () =>
            Match.value(status).pipe(
              Match.withReturnType<LinkStep>(),
              Match.tags({
                Returning: () => [RECOVERED, ['StartRecoveredTimer']],
                Unreachable: () => [RECOVERED, ['StartRecoveredTimer']],
                Offline: () => [RECOVERED, ['StartRecoveredTimer']],
                Recovered: () => to(RECOVERED),
              }),
              Match.orElse(() => to(LIVE)),
            ),
          RecoveredNoticeEnded: () => to(LinkStatus.guards.Recovered(status) ? LIVE : status),
          ConnectionDropped: () => to(isAnswering(status) ? REDIALING : status),
          DialRefused: () => to(UNREACHABLE),
          SessionExpired: () => to(EXPIRED),
          WentOffline: () => to(OFFLINE),
          PageHidden: () =>
            to(isAnswering(status) || LinkStatus.guards.Redialing(status) ? PARKED : status),
          LoggedOutConfirmed: () => to(LOGGED_OUT),
        }),
      )

export const linkMachine: Machine<LinkStatus, LinkEvent, LinkCommand> = {
  name: 'link',
  states: LinkStatus,
  events: LinkEvent,
  initial: COLD_START,
  transition: linkTransition,
}

export const refusesCalls = LinkStatus.isAnyOf([
  'Returning',
  'Unreachable',
  'Offline',
  'Expired',
  'LoggedOut',
])

export const settledSince =
  (requestedAt: DateTime.Utc) =>
  (state: HubLinkState): boolean =>
    hasGivenUp(state.status) ||
    (isAnswering(state.status) &&
      Option.exists(state.herd, (herd) => DateTime.isGreaterThan(herd.syncedAt, requestedAt)))
