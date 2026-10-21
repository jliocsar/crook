import type * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import { LinkStatus } from '@crook/web/rpc/HubLinkState'
import type { HubLinkState } from '@crook/web/rpc/HubLinkState'

export type ConnectionNotice = 'connecting' | 'syncing' | 'unreachable' | 'offline' | 'recovered'

export interface ConnectionView {
  readonly ready: boolean
  readonly notice: Option.Option<ConnectionNotice>
  readonly stale: boolean
  readonly canAct: boolean
  readonly controlsEnabled: boolean
  readonly expired: boolean
  readonly loggedOut: boolean
  readonly syncedAt: Option.Option<DateTime.Utc>
}

export const STARTING_VIEW: ConnectionView = {
  ready: false,
  notice: Option.none(),
  stale: false,
  canAct: false,
  controlsEnabled: false,
  expired: false,
  loggedOut: false,
  syncedAt: Option.none(),
}

export const connectionView = (state: HubLinkState): ConnectionView => {
  const syncedAt = Option.map(state.herd, (herd) => herd.syncedAt)
  const base = { ...STARTING_VIEW, ready: true, syncedAt }

  return LinkStatus.$match(state.status, {
    Dialing: ({ announced, coldStart }): ConnectionView => ({
      ...base,
      notice: announced
        ? Option.some(Option.isSome(state.herd) ? 'syncing' : 'connecting')
        : Option.none(),
      stale: announced || coldStart,
      controlsEnabled: !announced && !coldStart,
    }),
    Live: ({ recovered }): ConnectionView => ({
      ...base,
      notice: recovered ? Option.some('recovered') : Option.none(),
      canAct: true,
      controlsEnabled: true,
    }),
    Unreachable: (): ConnectionView => ({
      ...base,
      notice: Option.some('unreachable'),
      stale: true,
    }),
    Offline: (): ConnectionView => ({ ...base, notice: Option.some('offline'), stale: true }),
    Expired: (): ConnectionView => ({ ...base, stale: true, expired: true }),
    LoggedOut: (): ConnectionView => ({ ...base, stale: true, loggedOut: true }),
  })
}

export const failedNotice = (notice: ConnectionNotice): boolean =>
  notice === 'unreachable' || notice === 'offline'
