import * as Data from 'effect/Data'
import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import { LinkStatus } from '@crook/web/rpc/HubLinkState'
import type { HubLinkState } from '@crook/web/rpc/HubLinkState'

export type ConnectionNotice = 'connecting' | 'syncing' | 'unreachable' | 'offline' | 'recovered'

export type ConnectionView = Data.TaggedEnum<{
  Starting: Record<never, never>
  Resuming: Record<never, never>
  Redialing: Record<never, never>
  Connecting: Record<never, never>
  Syncing: Record<never, never>
  Returning: { readonly notice: 'connecting' | 'syncing' }
  Live: Record<never, never>
  Recovered: Record<never, never>
  Unreachable: { readonly syncedAt: Option.Option<DateTime.Utc> }
  Offline: { readonly syncedAt: Option.Option<DateTime.Utc> }
  Expired: Record<never, never>
  LoggedOut: Record<never, never>
}>

const NO_NOTICE = Option.none<ConnectionNotice>()

export const ConnectionView = Data.taggedEnum<ConnectionView>()

export const STARTING_VIEW = ConnectionView.Starting()

const noticeSaying = (notice: ConnectionNotice) => Option.some(notice)

export const connectionView = (state: HubLinkState): ConnectionView => {
  const syncedAt = Option.map(state.herd, (herd) => herd.syncedAt)
  const hasHerd = Option.isSome(state.herd)

  return LinkStatus.match<ConnectionView>(state.status, {
    ColdStart: () => (hasHerd ? ConnectionView.Resuming() : ConnectionView.Starting()),
    Redialing: () => ConnectionView.Redialing(),
    Parked: () => ConnectionView.Redialing(),
    Announced: () => (hasHerd ? ConnectionView.Syncing() : ConnectionView.Connecting()),
    Returning: () => ConnectionView.Returning({ notice: hasHerd ? 'syncing' : 'connecting' }),
    Live: () => ConnectionView.Live(),
    Recovered: () => ConnectionView.Recovered(),
    Unreachable: () => ConnectionView.Unreachable({ syncedAt }),
    Offline: () => ConnectionView.Offline({ syncedAt }),
    Expired: () => ConnectionView.Expired(),
    LoggedOut: () => ConnectionView.LoggedOut(),
  })
}

export const allowsActions: (view: ConnectionView) => boolean = ConnectionView.$match({
  Starting: () => true,
  Resuming: () => true,
  Redialing: () => true,
  Connecting: () => true,
  Syncing: () => true,
  Returning: () => false,
  Live: () => true,
  Recovered: () => true,
  Unreachable: () => false,
  Offline: () => false,
  Expired: () => false,
  LoggedOut: () => false,
})

export const dimsContent: (view: ConnectionView) => boolean = ConnectionView.$match({
  Starting: () => false,
  Resuming: () => false,
  Redialing: () => false,
  Connecting: () => false,
  Syncing: () => false,
  Returning: () => true,
  Live: () => false,
  Recovered: () => false,
  Unreachable: () => true,
  Offline: () => true,
  Expired: () => false,
  LoggedOut: () => false,
})

export const isVerified: (view: ConnectionView) => boolean = ConnectionView.$match({
  Starting: () => false,
  Resuming: () => false,
  Redialing: () => true,
  Connecting: () => false,
  Syncing: () => false,
  Returning: () => false,
  Live: () => true,
  Recovered: () => true,
  Unreachable: () => false,
  Offline: () => false,
  Expired: () => false,
  LoggedOut: () => false,
})

export const isConnected = ConnectionView.$is('Live')

export const noticeOf: (view: ConnectionView) => Option.Option<ConnectionNotice> =
  ConnectionView.$match({
    Starting: () => NO_NOTICE,
    Resuming: () => NO_NOTICE,
    Redialing: () => NO_NOTICE,
    Connecting: () => noticeSaying('connecting'),
    Syncing: () => noticeSaying('syncing'),
    Returning: ({ notice }) => noticeSaying(notice),
    Live: () => NO_NOTICE,
    Recovered: () => noticeSaying('recovered'),
    Unreachable: () => noticeSaying('unreachable'),
    Offline: () => noticeSaying('offline'),
    Expired: () => NO_NOTICE,
    LoggedOut: () => NO_NOTICE,
  })

export const syncedAtOf: (view: ConnectionView) => Option.Option<DateTime.Utc> =
  ConnectionView.$match({
    Starting: () => Option.none(),
    Resuming: () => Option.none(),
    Redialing: () => Option.none(),
    Connecting: () => Option.none(),
    Syncing: () => Option.none(),
    Returning: () => Option.none(),
    Live: () => Option.none(),
    Recovered: () => Option.none(),
    Unreachable: ({ syncedAt }) => syncedAt,
    Offline: ({ syncedAt }) => syncedAt,
    Expired: () => Option.none(),
    LoggedOut: () => Option.none(),
  })
