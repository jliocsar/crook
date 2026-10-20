export type Point = { readonly clientX: number; readonly clientY: number }

export type SwipeRelease = {
  readonly offset: number
  readonly velocity: number
  readonly actionsWidth: number
}

export const LONG_PRESS_MS = 500
export const MOVE_SLOP = 8
export const OPEN_VELOCITY = 500

export const movedPastSlop = (origin: Point, point: Point): boolean =>
  Math.hypot(point.clientX - origin.clientX, point.clientY - origin.clientY) > MOVE_SLOP

export const settlesOpen = ({ offset, velocity, actionsWidth }: SwipeRelease): boolean => {
  if (velocity < -OPEN_VELOCITY) {
    return true
  }

  if (velocity > OPEN_VELOCITY) {
    return false
  }

  return offset < -actionsWidth / 2
}
