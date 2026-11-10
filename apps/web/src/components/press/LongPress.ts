import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as React from 'react'

import { LONG_PRESS_MS, movedPastSlop } from '@crook/web/components/press/PressGesture'
import type { Point } from '@crook/web/components/press/PressGesture'

type LongPressHandlers = Pick<
  React.DOMAttributes<HTMLElement>,
  | 'onPointerDown'
  | 'onPointerMove'
  | 'onPointerUp'
  | 'onPointerCancel'
  | 'onPointerLeave'
  | 'onContextMenu'
>

const PRIMARY_BUTTON = 0

export const useLongPress = (onLongPress: (() => void) | undefined) => {
  const timer = React.useRef<Option.Option<() => void>>(Option.none())
  const origin = React.useRef<Option.Option<Point>>(Option.none())
  const fired = React.useRef(false)

  const clear = () => {
    if (Option.isSome(timer.current)) {
      timer.current.value()
    }

    timer.current = Option.none()
    origin.current = Option.none()
  }

  React.useEffect(() => clear, [])

  const fire = () => {
    timer.current = Option.none()
    fired.current = true
    onLongPress?.()
  }

  const handlers: LongPressHandlers = {
    onPointerDown: (event) => {
      if (event.button !== PRIMARY_BUTTON || onLongPress === undefined) {
        return
      }

      clear()
      fired.current = false
      origin.current = Option.some({ clientX: event.clientX, clientY: event.clientY })
      timer.current = Option.some(
        Effect.runCallback(
          Effect.sleep(Duration.millis(LONG_PRESS_MS)).pipe(Effect.andThen(Effect.sync(fire))),
        ),
      )
    },
    onPointerMove: (event) => {
      if (Option.exists(origin.current, (start) => movedPastSlop(start, event))) {
        clear()
      }
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (event) => {
      if (onLongPress === undefined) {
        return
      }

      event.preventDefault()
      const alreadyFired = fired.current

      clear()

      if (!alreadyFired) {
        onLongPress()
      }
    },
  }

  const consumeLongPress = (): boolean => {
    const wasLongPress = fired.current

    fired.current = false

    return wasLongPress
  }

  return { handlers, consumeLongPress }
}
