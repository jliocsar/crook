import { describe, expect, it } from 'vitest'

import { hookPath, hookShape, LINE_X, pointAlong, RADIUS } from '@crook/web/chat/HookPath'

const SHAPE = hookShape(100, 400, 150)

describe('hookPath', () => {
  it('draws the line, the curve and the run as one path', () => {
    expect(hookPath(SHAPE)).toBe(`M${LINE_X} 100 V392 A8 8 0 0 0 ${LINE_X + RADIUS} 400 H150`)
    expect(hookPath(SHAPE).match(/M/gu)).toHaveLength(1)
  })
})

describe('pointAlong', () => {
  it('meets the curve where the line ends', () => {
    const lineEnd = pointAlong(SHAPE, SHAPE.vertical)
    const curveStart = pointAlong(SHAPE, SHAPE.vertical + 1e-9)

    expect(lineEnd.left).toBeCloseTo(curveStart.left)
    expect(lineEnd.top).toBeCloseTo(curveStart.top)
  })

  it('meets the run where the curve ends, turned all the way', () => {
    const curveEnd = pointAlong(SHAPE, SHAPE.vertical + SHAPE.arc)
    const runStart = pointAlong(SHAPE, SHAPE.vertical + SHAPE.arc + 1e-9)

    expect(curveEnd.left).toBeCloseTo(LINE_X + RADIUS)
    expect(curveEnd.top).toBeCloseTo(400)
    expect(curveEnd.turn).toBeCloseTo(1)
    expect(runStart.left).toBeCloseTo(curveEnd.left)
    expect(runStart.top).toBeCloseTo(curveEnd.top)
  })

  it("ends at the run's far end after the whole length", () => {
    expect(pointAlong(SHAPE, SHAPE.total)).toMatchObject({ left: 150, top: 400, turn: 1 })
  })
})
