export interface HookGeometry {
  readonly y0: number
  readonly yc: number
  readonly xEnd: number
  readonly vertical: number
  readonly arc: number
  readonly total: number
}

export interface HookPoint {
  readonly left: number
  readonly top: number
  readonly turn: number
}

const QUARTER_TURN = Math.PI / 2

export const LINE_X = 7
export const RADIUS = 8

export const hookShape = (y0: number, yc: number, xEnd: number): HookGeometry => {
  const vertical = Math.max(0, yc - RADIUS - y0)
  const arc = RADIUS * QUARTER_TURN
  const horizontal = Math.max(0, xEnd - (LINE_X + RADIUS))

  return { y0, yc, xEnd, vertical, arc, total: vertical + arc + horizontal }
}

export const hookPath = (shape: HookGeometry): string =>
  `M${LINE_X} ${shape.y0} V${shape.yc - RADIUS} A${RADIUS} ${RADIUS} 0 0 0 ${LINE_X + RADIUS} ${shape.yc} H${shape.xEnd}`

export const ridePath = (y0: number, length: number): string => `M${LINE_X} ${y0} V${y0 + length}`

export const pointAlong = (shape: HookGeometry, distance: number): HookPoint => {
  if (distance <= shape.vertical) {
    return { left: LINE_X, top: shape.y0 + distance, turn: 0 }
  }

  if (distance <= shape.vertical + shape.arc) {
    const angle = (distance - shape.vertical) / RADIUS

    return {
      left: LINE_X + RADIUS - RADIUS * Math.cos(angle),
      top: shape.yc - RADIUS + RADIUS * Math.sin(angle),
      turn: angle / QUARTER_TURN,
    }
  }

  return {
    left: LINE_X + RADIUS + (distance - shape.vertical - shape.arc),
    top: shape.yc,
    turn: 1,
  }
}
