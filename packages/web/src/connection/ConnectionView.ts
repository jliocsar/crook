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
  readonly expired: boolean
  readonly syncedAt: Option.Option<DateTime.Utc>
}

export const STARTING_VIEW: ConnectionView = {
  ready: false,
  notice: Option.none(),
  stale: false,
  canAct: false,
  expired: false,
  syncedAt: Option.none(),
}

const RECOVERED: ConnectionNotice = 'recovered'

const dialingNotice = (announced: boolean, hasHerd: boolean): Option.Option<ConnectionNotice> => {
  const notice: ConnectionNotice = hasHerd ? 'syncing' : 'connecting'

  return Option.liftPredicate(notice, () => announced)
}

export const connectionView = (state: HubLinkState): ConnectionView => {
  const syncedAt = Option.map(state.herd, (herd) => herd.syncedAt)
  const base = { ...STARTING_VIEW, ready: true, syncedAt }

  return LinkStatus.$match(state.status, {
    Dialing: ({ announced }): ConnectionView => ({
      ...base,
      notice: dialingNotice(announced, Option.isSome(state.herd)),
      stale: announced,
    }),
    Live: ({ recovered }): ConnectionView => ({
      ...base,
      notice: Option.liftPredicate(RECOVERED, () => recovered),
      canAct: true,
    }),
    Unreachable: (): ConnectionView => ({
      ...base,
      notice: Option.some('unreachable'),
      stale: true,
    }),
    Offline: (): ConnectionView => ({ ...base, notice: Option.some('offline'), stale: true }),
    Expired: (): ConnectionView => ({ ...base, stale: true, expired: true }),
  })
}

export const failedNotice = (notice: ConnectionNotice): boolean =>
  notice === 'unreachable' || notice === 'offline'
