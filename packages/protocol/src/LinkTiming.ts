import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import * as Schedule from 'effect/Schedule'

export const LINK_PING_INTERVAL = Duration.seconds(5)
export const LINK_OPEN_TIMEOUT = Duration.seconds(10)
export const RECONNECT_GRACE = Duration.sum(LINK_OPEN_TIMEOUT, LINK_PING_INTERVAL)
export const HUB_RECONNECT_BASE = Duration.millis(77)
export const RECONNECT_CAP = LINK_PING_INTERVAL

export const reconnectBackoff = (base: Duration.Duration) =>
  Schedule.min([Schedule.exponential(base), Schedule.spaced(RECONNECT_CAP)])

export const stayedHealthy = (liveSince: Option.Option<number>, now: number): boolean =>
  Option.exists(liveSince, (first) => now - first >= Duration.toMillis(RECONNECT_CAP))

export const hubReconnectSchedule = reconnectBackoff(HUB_RECONNECT_BASE)
