import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Option from 'effect/Option'
import type * as React from 'react'
import { useRef } from 'react'

import { LONG_PRESS_MS, movedPastSlop } from '@/components/swipe/Gestures'
import type { Point } from '@/components/swipe/Gestures'

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

export const useLongPress = (onLongPress: () => void) => {
  const timer = useRef<Option.Option<Fiber.Fiber<void>>>(Option.none())
  const origin = useRef<Option.Option<Point>>(Option.none())
  const fired = useRef(false)

  const clear = () => {
    Option.map(timer.current, (fiber) => Effect.runFork(Fiber.interrupt(fiber)))
    timer.current = Option.none()
    origin.current = Option.none()
  }

  const fire = () => {
    fired.current = true
    onLongPress()
  }

  const handlers: LongPressHandlers = {
    onPointerDown: (event) => {
      if (event.button !== PRIMARY_BUTTON) {
        return
      }

      fired.current = false
      origin.current = Option.some({ clientX: event.clientX, clientY: event.clientY })
      timer.current = Option.some(
        Effect.runFork(
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
