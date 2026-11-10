import * as React from 'react'

import type { ComposerHandle } from '@crook/web/chat/Composer'

const VISIBLE_FOCUS = ':focus-visible'

const isWithin = (
  region: React.RefObject<HTMLElement | null>,
  target: EventTarget | null,
): target is Element =>
  target instanceof Element && region.current !== null && region.current.contains(target)

export const useFocusAfterAsk = (askKey: string) => {
  const region = React.useRef<HTMLElement>(null)
  const composer = React.useRef<ComposerHandle>(null)
  const askFocused = React.useRef(false)

  const holdsVisibleFocus = (target: EventTarget | null): boolean =>
    isWithin(region, target) && target.matches(VISIBLE_FOCUS)

  React.useEffect(() => {
    if (!askFocused.current) {
      return
    }

    askFocused.current = false

    const active = document.activeElement
    const lost = active === null || active === document.body || isWithin(region, active)

    if (lost) {
      composer.current?.focus()
    }
  }, [askKey])

  return {
    region,
    composer,
    onFocus: (event: React.FocusEvent) => {
      askFocused.current = holdsVisibleFocus(event.target)
    },
    onBlur: (event: React.FocusEvent) => {
      if (event.relatedTarget !== null) {
        askFocused.current = holdsVisibleFocus(event.relatedTarget)
      }
    },
  }
}
