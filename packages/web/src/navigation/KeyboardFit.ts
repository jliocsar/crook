import * as Option from 'effect/Option'
import * as React from 'react'

export interface KeyboardFit {
  readonly top: number
  readonly height: number
}

type ViewportBox = Pick<VisualViewport, 'height' | 'offsetTop' | 'scale'>

type KeyboardFitStyle = Partial<KeyboardFit & { readonly bottom: 'auto' }>

const UNZOOMED_SCALE = 1

export const keyboardFitOf = (
  viewport: ViewportBox,
  layoutHeight: number,
): Option.Option<KeyboardFit> =>
  Option.map(
    Option.liftPredicate(
      viewport,
      (visual) => visual.scale === UNZOOMED_SCALE && Math.round(layoutHeight - visual.height) > 0,
    ),
    (visual) => ({ top: visual.offsetTop, height: visual.height }),
  )

export const keyboardFitStyle = (fit: Option.Option<KeyboardFit>): KeyboardFitStyle =>
  Option.match(fit, {
    onNone: () => ({}),
    onSome: ({ top, height }) => ({ top, height, bottom: 'auto' }),
  })

const sameFit = Option.makeEquivalence(
  (left: KeyboardFit, right: KeyboardFit) => left.top === right.top && left.height === right.height,
)

export const useKeyboardFit = (): Option.Option<KeyboardFit> => {
  const [fit, setFit] = React.useState<Option.Option<KeyboardFit>>(Option.none())

  React.useEffect(
    () =>
      Option.match(Option.fromNullishOr(window.visualViewport), {
        onNone: () => undefined,
        onSome: (visual) => {
          const measure = () => {
            const next = keyboardFitOf(visual, window.innerHeight)

            if (Option.isSome(next) && window.scrollY !== 0) {
              window.scrollTo(0, 0)
            }

            setFit((previous) => (sameFit(previous, next) ? previous : next))
          }

          visual.addEventListener('resize', measure)
          visual.addEventListener('scroll', measure)
          window.addEventListener('scroll', measure)
          measure()

          return () => {
            visual.removeEventListener('resize', measure)
            visual.removeEventListener('scroll', measure)
            window.removeEventListener('scroll', measure)
          }
        },
      }),
    [],
  )

  return fit
}
