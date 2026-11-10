import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'

import {
  fitWithin,
  isDismissal,
  pannedView,
  pinchedView,
  REST,
  zoomedAt,
} from '@crook/web/chat/ImageZoom'
import type { Frame, Pan, Pinch } from '@crook/web/chat/ImageZoom'

const frame: Frame = {
  left: 0,
  top: 0,
  width: 375,
  height: 812,
  shownWidth: 375,
  shownHeight: 250,
}

const stage = Option.some(frame)

const pan = (overrides: Partial<Pan> = {}): Pan => ({
  kind: 'pan',
  origin: { left: 187.5, top: 406 },
  start: REST,
  afterPinch: false,
  moved: true,
  samples: [],
  ...overrides,
})

describe('fitWithin', () => {
  it('keeps a zoomed picture from sliding past its own edges', () => {
    const fitted = fitWithin(stage, { scale: 2, shiftX: 1000, shiftY: -1000, drop: 0 })

    expect(fitted.shiftX).toBe(187.5)
    expect(Math.abs(fitted.shiftY)).toBe(0)
  })

  it('leaves the view alone while the stage is not laid out', () => {
    const view = { scale: 2, shiftX: 1000, shiftY: 0, drop: 0 }

    expect(fitWithin(Option.none(), view)).toBe(view)
  })
})

describe('zoomedAt', () => {
  it('zooms in on the tapped spot', () => {
    const zoomed = zoomedAt(stage, { left: 287.5, top: 406 })

    expect(zoomed.scale).toBe(2.5)
    expect(zoomed.shiftX).toBe(-150)
  })
})

describe('pinchedView', () => {
  const pinch: Pinch = { kind: 'pinch', distance: 100, mid: { left: 0, top: 0 }, start: REST }

  it('scales by how far the fingers spread, within the zoom limits', () => {
    expect(
      pinchedView(stage, pinch, [
        { left: 87.5, top: 406 },
        { left: 287.5, top: 406 },
      ]).scale,
    ).toBe(2)
    expect(
      pinchedView(stage, pinch, [
        { left: 0, top: 406 },
        { left: 1000, top: 406 },
      ]).scale,
    ).toBe(4)
    expect(
      pinchedView(stage, pinch, [
        { left: 180, top: 406 },
        { left: 190, top: 406 },
      ]).scale,
    ).toBe(1)
  })
})

describe('pannedView', () => {
  it('drops an unzoomed picture with the finger', () => {
    expect(pannedView(stage, pan(), { left: 187.5, top: 506 })).toEqual({ ...REST, drop: 100 })
  })

  it('moves a zoomed picture instead of dropping it', () => {
    const moved = pannedView(stage, pan({ start: { ...REST, scale: 2 } }), {
      left: 287.5,
      top: 406,
    })

    expect(moved.drop).toBe(0)
    expect(moved.shiftX).toBe(100)
  })
})

describe('isDismissal', () => {
  it('closes after a long drop, or a short fast flick in the same direction', () => {
    expect(isDismissal(120, [], 0)).toBe(true)
    expect(
      isDismissal(
        40,
        [
          { top: 0, at: 950 },
          { top: 40, at: 1000 },
        ],
        1000,
      ),
    ).toBe(true)
    expect(
      isDismissal(
        40,
        [
          { top: 40, at: 950 },
          { top: 0, at: 1000 },
        ],
        1000,
      ),
    ).toBe(false)
    expect(isDismissal(40, [], 1000)).toBe(false)
  })
})
