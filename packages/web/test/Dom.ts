import { act, screen, waitFor } from '@testing-library/react'
import type { ByRoleMatcher } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

export type PathPoint = readonly [clientX: number, clientY: number]

type Lift = 'pointerup' | 'pointercancel'

const SPRING_SETTLED_MS = 2000

export const click = (element: Element) => Effect.promise(() => userEvent.click(element))

export const findByRole = (role: ByRoleMatcher, name: string) =>
  Effect.promise(() => screen.findByRole(role, { name }))

export const eventually = (assertion: () => void) => Effect.promise(() => waitFor(assertion))

export const present = <Value>(value: Value | null | undefined, what: string): NonNullable<Value> =>
  Option.getOrThrowWith(Option.fromNullishOr(value), () => new Error(`${what} is not on the page.`))

export const afterSpring = (assertion: () => void) =>
  Effect.promise(() => waitFor(assertion, { timeout: SPRING_SETTLED_MS }))

export const pointer = (type: string, target: EventTarget, clientX: number, clientY = 0): void => {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'touch',
    clientX,
    clientY,
  })

  Object.defineProperty(event, 'pageX', { value: clientX })
  Object.defineProperty(event, 'pageY', { value: clientY })
  target.dispatchEvent(event)
}

export const wait = (milliseconds: number) =>
  Effect.promise(() => act(() => Effect.runPromise(Effect.sleep(Duration.millis(milliseconds)))))

export const springSettles = wait(SPRING_SETTLED_MS)

export const press = Effect.fn('press')(function* (
  target: Element,
  path: readonly PathPoint[],
  stepMs: number = DRAG_STEP_MS,
) {
  const [[startX, startY] = [0, 0], ...moves] = path

  pointer('pointerdown', target, startX, startY)

  for (const [clientX, clientY] of moves) {
    yield* wait(stepMs)
    pointer('pointermove', target, clientX, clientY)
  }

  yield* wait(stepMs)
})

export const lift = Effect.fn('lift')(function* (
  target: Element,
  [clientX, clientY]: PathPoint,
  how: Lift = 'pointerup',
) {
  pointer(how, target, clientX, clientY)
  yield* wait(DRAG_STEP_MS)
})

export const drag = Effect.fn('drag')(function* (
  target: Element,
  path: readonly PathPoint[],
  { how = 'pointerup', stepMs = DRAG_STEP_MS }: { how?: Lift; stepMs?: number } = {},
) {
  yield* press(target, path, stepMs)
  yield* lift(target, path.at(-1) ?? [0, 0], how)
})

export const dragX = (target: Element, path: readonly number[]) =>
  drag(
    target,
    path.map((clientX) => [clientX, 0] as const),
  )

const DRAG_STEP_MS = 50
