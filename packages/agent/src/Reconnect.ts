import * as Clock from 'effect/Clock'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'
import * as Schedule from 'effect/Schedule'

import { AGENT_PING_INTERVAL } from '@crook/protocol/AgentLink'

export const RECONNECT_CAP = AGENT_PING_INTERVAL

export const reconnectBackoff = (base: Duration.Duration) =>
  Schedule.min([Schedule.exponential(base), Schedule.spaced(RECONNECT_CAP)])

export const trackConnectionHealth = Effect.gen(function* () {
  const healthySince = yield* Ref.make(Option.none<number>())
  const markHealthy = Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Ref.update(
      healthySince,
      Option.orElseSome(() => now),
    ),
  )
  const stayedHealthy = Effect.zipWith(
    Ref.get(healthySince),
    Clock.currentTimeMillis,
    (since, now) =>
      Option.exists(since, (first) => now - first >= Duration.toMillis(RECONNECT_CAP)),
  )

  return { markHealthy, stayedHealthy }
})
