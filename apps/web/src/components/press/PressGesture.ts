export type Point = { readonly clientX: number; readonly clientY: number }

export const LONG_PRESS_MS = 500
export const MOVE_SLOP = 8

export const movedPastSlop = (origin: Point, point: Point): boolean =>
  Math.hypot(point.clientX - origin.clientX, point.clientY - origin.clientY) > MOVE_SLOP
