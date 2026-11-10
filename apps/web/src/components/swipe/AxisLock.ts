import * as Option from 'effect/Option'
import * as React from 'react'

import type { Point } from '@crook/web/components/press/PressGesture'

export type Axis = 'x' | 'y'

export const AXIS_LOCK_DISTANCE = 10

export const lockedAxis = (origin: Point, point: Point): Option.Option<Axis> => {
  const across = Math.abs(point.clientX - origin.clientX)
  const along = Math.abs(point.clientY - origin.clientY)

  return Option.map(
    Option.liftPredicate(Math.max(across, along), (distance) => distance >= AXIS_LOCK_DISTANCE),
    (): Axis => (across > along ? 'x' : 'y'),
  )
}

export const useAxisLock = (onLock: (axis: Axis) => void = () => undefined) => {
  const origin = React.useRef<Option.Option<Point>>(Option.none())
  const axis = React.useRef<Option.Option<Axis>>(Option.none())

  const begin = ({ clientX, clientY }: Point) => {
    origin.current = Option.some({ clientX, clientY })
    axis.current = Option.none()
  }

  const follow = (point: Point): Option.Option<Axis> => {
    if (Option.isSome(axis.current)) {
      return axis.current
    }

    axis.current = Option.flatMap(origin.current, (start) => lockedAxis(start, point))

    if (Option.isSome(axis.current)) {
      onLock(axis.current.value)
    }

    return axis.current
  }

  const release = (): Option.Option<Axis> => {
    const locked = axis.current

    origin.current = Option.none()
    axis.current = Option.none()

    return locked
  }

  return { begin, follow, release }
}
