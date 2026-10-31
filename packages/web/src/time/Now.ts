import { RegistryContext } from '@effect/atom-react/RegistryContext'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import { constVoid } from 'effect/Function'
import * as React from 'react'

import { useCoveredAtom } from '@crook/web/navigation/Covered'

const LABEL_RESOLUTION = Duration.seconds(1)

const everySecond = (tick: () => void): (() => void) => {
  const timer = window.setInterval(tick, Duration.toMillis(LABEL_RESOLUTION))

  return () => {
    window.clearInterval(timer)
  }
}

export const useNow = (ticking = true): DateTime.Utc => {
  const [now, setNow] = React.useState(DateTime.nowUnsafe)
  const wasTicking = React.useRef(ticking)
  const registry = React.useContext(RegistryContext)
  const covered = useCoveredAtom()

  React.useEffect(() => {
    if (!ticking) {
      wasTicking.current = false

      return undefined
    }

    const tick = () => {
      setNow(DateTime.nowUnsafe())
    }

    if (!wasTicking.current) {
      wasTicking.current = true
      tick()
    }

    let stop = registry.get(covered) ? constVoid : everySecond(tick)

    const unsubscribe = registry.subscribe(covered, (hidden) => {
      stop()
      stop = hidden ? constVoid : everySecond(tick)

      if (!hidden) {
        tick()
      }
    })

    return () => {
      unsubscribe()
      stop()
    }
  }, [ticking, registry, covered])

  return now
}
