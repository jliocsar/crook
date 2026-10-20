import { act, screen, waitFor } from '@testing-library/react'
import type { ByRoleMatcher } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'

const SPRING_SETTLED_MS = 2000

export const click = (element: Element) => Effect.promise(() => userEvent.click(element))

export const findByRole = (role: ByRoleMatcher, name: string) =>
  Effect.promise(() => screen.findByRole(role, { name }))

export const eventually = (assertion: () => void) => Effect.promise(() => waitFor(assertion))

export const afterSpring = (assertion: () => void) =>
  Effect.promise(() => waitFor(assertion, { timeout: SPRING_SETTLED_MS }))

export const pointer = (type: string, target: EventTarget, clientX: number): void => {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'touch',
    clientX,
    clientY: 0,
  })

  Object.defineProperty(event, 'pageX', { value: clientX })
  Object.defineProperty(event, 'pageY', { value: 0 })
  target.dispatchEvent(event)
}

export const wait = (milliseconds: number) =>
  Effect.promise(() => act(() => Effect.runPromise(Effect.sleep(Duration.millis(milliseconds)))))

export const springSettles = wait(SPRING_SETTLED_MS)

export const dragX = Effect.fn('dragX')(function* (target: Element, path: readonly number[]) {
  const [start = 0, ...moves] = path

  pointer('pointerdown', target, start)

  for (const clientX of moves) {
    yield* wait(DRAG_STEP_MS)
    pointer('pointermove', window, clientX)
  }

  yield* wait(DRAG_STEP_MS)
  pointer('pointerup', window, moves.at(-1) ?? start)
  yield* wait(DRAG_STEP_MS)
})

const DRAG_STEP_MS = 50
