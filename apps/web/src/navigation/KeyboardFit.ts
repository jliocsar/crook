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

const takesTyping = (element: Element | null): boolean =>
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLInputElement ||
  (element instanceof HTMLElement && element.isContentEditable)

export const useKeyboardFit = (): Option.Option<KeyboardFit> => {
  const [fit, setFit] = React.useState<Option.Option<KeyboardFit>>(Option.none())

  React.useEffect(
    () =>
      Option.match(Option.fromNullishOr(window.visualViewport), {
        onNone: () => undefined,
        onSome: (visual) => {
          let frame = 0
          let shown: Option.Option<KeyboardFit> = Option.none()

          const measure = (): Option.Option<KeyboardFit> => {
            const next = keyboardFitOf(visual, window.innerHeight)

            if (Option.isSome(next) && window.scrollY !== 0) {
              window.scrollTo(0, 0)
            }

            if (!sameFit(shown, next)) {
              shown = next
              setFit(next)
            }

            return next
          }

          const watch = () => {
            const next = measure()

            frame =
              Option.isSome(next) || takesTyping(document.activeElement)
                ? requestAnimationFrame(watch)
                : 0
          }

          const heard = () => {
            cancelAnimationFrame(frame)
            watch()
          }

          visual.addEventListener('resize', heard)
          visual.addEventListener('scroll', heard)
          window.addEventListener('scroll', heard)
          document.addEventListener('focusin', heard)
          document.addEventListener('focusout', heard)
          heard()

          return () => {
            cancelAnimationFrame(frame)
            visual.removeEventListener('resize', heard)
            visual.removeEventListener('scroll', heard)
            window.removeEventListener('scroll', heard)
            document.removeEventListener('focusin', heard)
            document.removeEventListener('focusout', heard)
          }
        },
      }),
    [],
  )

  return fit
}
