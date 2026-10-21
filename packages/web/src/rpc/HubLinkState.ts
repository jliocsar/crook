import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import type { HerdSnapshot } from '@crook/web/cache/HerdCache'

export type LinkStatus = Data.TaggedEnum<{
  Dialing: {
    readonly announced: boolean
    readonly afterFailure: boolean
    readonly coldStart: boolean
  }
  Live: { readonly recovered: boolean }
  Unreachable: Record<never, never>
  Offline: Record<never, never>
  Expired: Record<never, never>
}>

export const LinkStatus = Data.taggedEnum<LinkStatus>()

export class HubLinkState extends Data.Class<{
  readonly status: LinkStatus
  readonly herd: Option.Option<HerdSnapshot>
}> {}

export const COLD_START = LinkStatus.Dialing({
  announced: false,
  afterFailure: false,
  coldStart: true,
})
export const QUIET_DIALING = LinkStatus.Dialing({
  announced: false,
  afterFailure: false,
  coldStart: false,
})

export const beginAttempt = LinkStatus.$match({
  Dialing: (dialing): LinkStatus => dialing,
  Live: (): LinkStatus => QUIET_DIALING,
  Unreachable: (unreachable): LinkStatus => unreachable,
  Offline: (): LinkStatus =>
    LinkStatus.Dialing({ announced: true, afterFailure: true, coldStart: false }),
  Expired: (expired): LinkStatus => expired,
})

export const announce = LinkStatus.$match({
  Dialing: ({ afterFailure, coldStart }): LinkStatus =>
    LinkStatus.Dialing({ announced: true, afterFailure, coldStart }),
  Live: (live): LinkStatus => live,
  Unreachable: (unreachable): LinkStatus => unreachable,
  Offline: (offline): LinkStatus => offline,
  Expired: (expired): LinkStatus => expired,
})

export const goLive = LinkStatus.$match({
  Dialing: ({ afterFailure }): LinkStatus => LinkStatus.Live({ recovered: afterFailure }),
  Live: (live): LinkStatus => live,
  Unreachable: (): LinkStatus => LinkStatus.Live({ recovered: true }),
  Offline: (): LinkStatus => LinkStatus.Live({ recovered: true }),
  Expired: (): LinkStatus => LinkStatus.Live({ recovered: false }),
})

export const settleRecovered = LinkStatus.$match({
  Dialing: (dialing): LinkStatus => dialing,
  Live: (): LinkStatus => LinkStatus.Live({ recovered: false }),
  Unreachable: (unreachable): LinkStatus => unreachable,
  Offline: (offline): LinkStatus => offline,
  Expired: (expired): LinkStatus => expired,
})

export const isRecovering = LinkStatus.$match({
  Dialing: () => false,
  Live: ({ recovered }) => recovered,
  Unreachable: () => false,
  Offline: () => false,
  Expired: () => false,
})

export const settledSince =
  (requestedAt: DateTime.Utc) =>
  (state: HubLinkState): boolean =>
    LinkStatus.$match(state.status, {
      Dialing: () => false,
      Live: () =>
        Option.exists(state.herd, (herd) => DateTime.isGreaterThan(herd.syncedAt, requestedAt)),
      Unreachable: () => true,
      Offline: () => true,
      Expired: () => true,
    })
