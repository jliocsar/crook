import { RegistryContext } from '@effect/atom-react/RegistryContext'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import { constVoid } from 'effect/Function'
import * as Atom from 'effect/reactivity/Atom'
import * as React from 'react'

import { useCoveredAtom } from '@crook/web/navigation/Covered'

const LABEL_RESOLUTION = Duration.seconds(1)

const secondsAtom = Atom.readable((get) => {
  const timer = window.setInterval(() => {
    get.setSelf(DateTime.nowUnsafe())
  }, Duration.toMillis(LABEL_RESOLUTION))

  get.addFinalizer(() => {
    window.clearInterval(timer)
  })

  return DateTime.nowUnsafe()
})

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

    const follow = () => {
      const unmount = registry.mount(secondsAtom)
      const unsubscribe = registry.subscribe(secondsAtom, setNow)

      return () => {
        unsubscribe()
        unmount()
      }
    }

    if (!wasTicking.current) {
      wasTicking.current = true
      setNow(DateTime.nowUnsafe())
    }

    let stop = registry.get(covered) ? constVoid : follow()

    const unsubscribe = registry.subscribe(covered, (hidden) => {
      stop()
      stop = hidden ? constVoid : follow()

      if (!hidden) {
        setNow(DateTime.nowUnsafe())
      }
    })

    return () => {
      unsubscribe()
      stop()
    }
  }, [ticking, registry, covered])

  return now
}
