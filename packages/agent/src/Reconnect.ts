import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Ref from 'effect/Ref'

import { stayedHealthy } from '@crook/protocol/LinkTiming'

export const trackConnectionHealth = Effect.gen(function* () {
  const healthySince = yield* Ref.make(Option.none<number>())
  const markHealthy = Effect.flatMap(Clock.currentTimeMillis, (now) =>
    Ref.update(
      healthySince,
      Option.orElseSome(() => now),
    ),
  )

  return {
    markHealthy,
    stayedHealthy: Effect.zipWith(Ref.get(healthySince), Clock.currentTimeMillis, stayedHealthy),
  }
})
