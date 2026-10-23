import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import { animate, mix, useReducedMotion } from 'motion/react'
import type { AnimationPlaybackControls } from 'motion/react'
import * as React from 'react'

import { MOVE_SLOP } from '@crook/web/components/press/PressGesture'
import { SWIPE_DISMISS_DISTANCE, SWIPE_DISMISS_VELOCITY } from '@crook/web/components/SwipeDismiss'
import { GLIDE } from '@crook/web/motion/Springs'

export type View = {
  readonly scale: number
  readonly shiftX: number
  readonly shiftY: number
  readonly drop: number
}

export type Point = { readonly left: number; readonly top: number }

type Sample = { readonly top: number; readonly at: number }

export type Pan = {
  readonly kind: 'pan'
  readonly origin: Point
  readonly start: View
  readonly afterPinch: boolean
  readonly moved: boolean
  readonly samples: readonly Sample[]
}

export type Pinch = {
  readonly kind: 'pinch'
  readonly distance: number
  readonly mid: Point
  readonly start: View
}

type Gesture = Pan | Pinch

export type Frame = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly shownWidth: number
  readonly shownHeight: number
}

const MAX_ZOOM = 4
const DOUBLE_TAP_ZOOM = 2.5
const DOUBLE_TAP_MS = 300
const FADE_DISTANCE = 320
const VELOCITY_WINDOW_MS = 80
const MIN_FLICK_DISTANCE = 24

export const REST: View = { scale: 1, shiftX: 0, shiftY: 0, drop: 0 }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const distanceBetween = (first: Point, second: Point) =>
  Math.hypot(first.left - second.left, first.top - second.top)

const midpoint = (first: Point, second: Point): Point => ({
  left: (first.left + second.left) / 2,
  top: (first.top + second.top) / 2,
})

const pointOf = (event: React.PointerEvent): Point => ({ left: event.clientX, top: event.clientY })

const frameOf = (stage: HTMLElement, shown: HTMLElement): Frame => {
  const rect = stage.getBoundingClientRect()

  return {
    left: rect.left,
    top: rect.top,
    width: stage.clientWidth,
    height: stage.clientHeight,
    shownWidth: shown.offsetWidth,
    shownHeight: shown.offsetHeight,
  }
}

const recentSamples = (samples: readonly Sample[], now: number): readonly Sample[] =>
  samples.filter((sample) => now - sample.at <= VELOCITY_WINDOW_MS)

const releaseVelocity = (samples: readonly Sample[], now: number): number => {
  const recent = recentSamples(samples, now)
  const first = recent.at(0)
  const last = recent.at(-1)

  if (first === undefined || last === undefined || last.at === first.at) {
    return 0
  }

  return (last.top - first.top) / Duration.toSeconds(Duration.millis(last.at - first.at))
}

export const isDismissal = (drop: number, samples: readonly Sample[], now: number): boolean => {
  const velocity = releaseVelocity(samples, now)
  const flicked =
    Math.abs(velocity) > SWIPE_DISMISS_VELOCITY &&
    Math.abs(drop) > MIN_FLICK_DISTANCE &&
    Math.sign(velocity) === Math.sign(drop)

  return Math.abs(drop) > SWIPE_DISMISS_DISTANCE || flicked
}

const relativeTo = (frame: Option.Option<Frame>, point: Point): Point =>
  Option.match(frame, {
    onNone: () => point,
    onSome: (found) => ({
      left: point.left - found.left - found.width / 2,
      top: point.top - found.top - found.height / 2,
    }),
  })

export const fitWithin = (frame: Option.Option<Frame>, next: View): View =>
  Option.match(frame, {
    onNone: () => next,
    onSome: (found) => {
      const spareX = Math.max(0, (found.shownWidth * next.scale - found.width) / 2)
      const spareY = Math.max(0, (found.shownHeight * next.scale - found.height) / 2)

      return {
        ...next,
        shiftX: clamp(next.shiftX, -spareX, spareX),
        shiftY: clamp(next.shiftY, -spareY, spareY),
      }
    },
  })

const pairOf = (pointers: ReadonlyMap<number, Point>): Option.Option<readonly [Point, Point]> => {
  const [first, second] = [...pointers.values()]

  return first === undefined || second === undefined ? Option.none() : Option.some([first, second])
}

export const zoomedAt = (frame: Option.Option<Frame>, point: Point): View => {
  const spot = relativeTo(frame, point)

  return fitWithin(frame, {
    scale: DOUBLE_TAP_ZOOM,
    shiftX: -spot.left * (DOUBLE_TAP_ZOOM - 1),
    shiftY: -spot.top * (DOUBLE_TAP_ZOOM - 1),
    drop: 0,
  })
}

export const pinchedView = (
  frame: Option.Option<Frame>,
  current: Pinch,
  [first, second]: readonly [Point, Point],
): View => {
  const scale = clamp(
    (current.start.scale * distanceBetween(first, second)) / current.distance,
    1,
    MAX_ZOOM,
  )
  const mid = relativeTo(frame, midpoint(first, second))
  const ratio = scale / current.start.scale

  return fitWithin(frame, {
    scale,
    shiftX: mid.left - (current.mid.left - current.start.shiftX) * ratio,
    shiftY: mid.top - (current.mid.top - current.start.shiftY) * ratio,
    drop: 0,
  })
}

export const pannedView = (frame: Option.Option<Frame>, current: Pan, point: Point): View => {
  const deltaX = point.left - current.origin.left
  const deltaY = point.top - current.origin.top

  return current.afterPinch || current.start.scale > 1
    ? fitWithin(frame, {
        ...current.start,
        shiftX: current.start.shiftX + deltaX,
        shiftY: current.start.shiftY + deltaY,
      })
    : { ...REST, drop: deltaY }
}

const paintView = (
  { scale, shiftX, shiftY, drop }: View,
  shown: HTMLElement | null,
  backdrop: HTMLElement | null,
) => {
  if (shown !== null) {
    shown.style.transform = `translate3d(${shiftX}px, ${shiftY + drop}px, 0) scale(${scale})`
  }

  if (backdrop !== null) {
    backdrop.style.opacity = String(1 - Math.min(1, Math.abs(drop) / FADE_DISTANCE))
  }
}

export function useZoom(onDismiss: () => void) {
  const stage = React.useRef<HTMLDivElement>(null)
  const picture = React.useRef<HTMLImageElement>(null)
  const backdrop = React.useRef<HTMLDivElement>(null)
  const view = React.useRef<View>(REST)
  const [pointers] = React.useState(() => new Map<number, Point>())
  const gesture = React.useRef<Option.Option<Gesture>>(Option.none())
  const lastTap = React.useRef(0)
  const settling = React.useRef<Option.Option<AnimationPlaybackControls>>(Option.none())
  const reduce = useReducedMotion() ?? false

  const frame = (): Option.Option<Frame> =>
    stage.current === null || picture.current === null
      ? Option.none()
      : Option.some(frameOf(stage.current, picture.current))

  const show = (next: View) => {
    view.current = next
    paintView(next, picture.current, backdrop.current)
  }

  const stopSettling = () => {
    if (Option.isSome(settling.current)) {
      settling.current.value.stop()
    }
  }

  const settle = (target: View) => {
    stopSettling()

    if (reduce) {
      show(target)

      return
    }

    const between = mix(view.current, target)

    settling.current = Option.some(
      animate(0, 1, {
        ...GLIDE,
        onUpdate: (progress) => {
          show(between(progress))
        },
      }),
    )
  }

  const beginPan = (point: Point, afterPinch: boolean) => {
    gesture.current = Option.some({
      kind: 'pan',
      origin: point,
      start: view.current,
      afterPinch,
      moved: false,
      samples: [{ top: point.top, at: performance.now() }],
    })
  }

  const settleInBounds = () => {
    settle(view.current.scale <= 1 ? REST : fitWithin(frame(), { ...view.current, drop: 0 }))
  }

  const onTap = (point: Point) => {
    const at = performance.now()

    if (at - lastTap.current > DOUBLE_TAP_MS) {
      lastTap.current = at

      return
    }

    lastTap.current = 0
    settle(view.current.scale > 1 ? REST : zoomedAt(frame(), point))
  }

  const movePan = (current: Pan, point: Point) => {
    const at = performance.now()

    gesture.current = Option.some({
      ...current,
      moved: current.moved || distanceBetween(point, current.origin) > MOVE_SLOP,
      samples: [...recentSamples(current.samples, at), { top: point.top, at }],
    })
    show(pannedView(frame(), current, point))
  }

  const releasePan = (current: Pan, released: Point) => {
    if (current.afterPinch) {
      settleInBounds()

      return
    }

    if (!current.moved) {
      onTap(released)

      return
    }

    if (current.start.scale > 1) {
      return
    }

    if (isDismissal(view.current.drop, current.samples, performance.now())) {
      onDismiss()

      return
    }

    settle(REST)
  }

  const onPointerDown = (event: React.PointerEvent) => {
    stopSettling()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.set(event.pointerId, pointOf(event))
    Option.match(pairOf(pointers), {
      onSome: ([first, second]) => {
        gesture.current = Option.some({
          kind: 'pinch',
          distance: distanceBetween(first, second),
          mid: relativeTo(frame(), midpoint(first, second)),
          start: view.current,
        })
      },
      onNone: () => {
        beginPan(pointOf(event), false)
      },
    })
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.has(event.pointerId)) {
      return
    }

    pointers.set(event.pointerId, pointOf(event))

    if (Option.isNone(gesture.current)) {
      return
    }

    const current = gesture.current.value
    const pair = pairOf(pointers)

    if (current.kind === 'pan') {
      movePan(current, pointOf(event))
    } else if (Option.isSome(pair)) {
      show(pinchedView(frame(), current, pair.value))
    }
  }

  const onPointerUp = (event: React.PointerEvent) => {
    const released = pointers.get(event.pointerId)
    const current = gesture.current
    const [remaining] = [...pointers.values()].filter((point) => point !== released)

    pointers.delete(event.pointerId)

    if (remaining !== undefined) {
      beginPan(
        remaining,
        Option.exists(current, (found) => found.kind === 'pinch' || found.afterPinch),
      )

      return
    }

    gesture.current = Option.none()

    if (Option.isNone(current) || released === undefined) {
      return
    }

    if (current.value.kind === 'pinch') {
      settleInBounds()
    } else {
      releasePan(current.value, released)
    }
  }

  const onPointerCancel = (event: React.PointerEvent) => {
    pointers.delete(event.pointerId)

    if (pointers.size === 0) {
      gesture.current = Option.none()
      settleInBounds()
    }
  }

  return {
    stage,
    picture,
    backdrop,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  }
}
