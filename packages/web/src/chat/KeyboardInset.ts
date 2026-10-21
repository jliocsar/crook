import * as Option from 'effect/Option'
import * as React from 'react'

const coveredBy = (viewport: VisualViewport): number =>
  Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))

export const useKeyboardInset = (): number => {
  const [inset, setInset] = React.useState(0)

  React.useEffect(() => {
    const viewport = Option.fromNullishOr(window.visualViewport)

    return Option.match(viewport, {
      onNone: () => undefined,
      onSome: (visual) => {
        const measure = () => {
          setInset(coveredBy(visual))
        }

        visual.addEventListener('resize', measure)
        visual.addEventListener('scroll', measure)
        measure()

        return () => {
          visual.removeEventListener('resize', measure)
          visual.removeEventListener('scroll', measure)
        }
      },
    })
  }, [])

  return inset
}
