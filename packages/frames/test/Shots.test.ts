import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'

import { flaggedFrames, tileFrames } from '@crook/frames/ContactSheet'
import { isStarved, shareOfSlowFrames } from '@crook/frames/FrameLog'
import type { RecordedFrame } from '@crook/frames/FrameLog'
import { imageWithItsAge, NO_IMAGE, shotOfFrame } from '@crook/frames/Shots'

const BOX = { x: 0, y: 0, width: 10, height: 10, opacity: 1 }

const frameAt = (frame: number, at: number, marks: readonly string[] = []): RecordedFrame => ({
  frame,
  at,
  vsync: at,
  phase: 'playing',
  mounted: true,
  blank: false,
  rows: 0,
  marks: Object.fromEntries(marks.map((mark) => [mark, BOX])),
  added: [],
  removed: [],
  readMs: 1,
})

describe('isStarved', () => {
  it('calls a run starved once more than a tenth of its frames took over 50 ms', () => {
    const steady = [frameAt(1, 0), frameAt(2, 17), frameAt(3, 34), frameAt(4, 51)]
    const starved = [frameAt(1, 0), frameAt(2, 17), frameAt(3, 100), frameAt(4, 117)]

    expect(isStarved(steady)).toBe(false)
    expect(shareOfSlowFrames(starved)).toBeCloseTo(1 / 3)
    expect(isStarved(starved)).toBe(true)
  })
})

describe('shotOfFrame', () => {
  const frames = [frameAt(1, 100), frameAt(2, 117), frameAt(3, 200)]
  const shots = [
    { index: 0, at: 90, file: 'a.jpg' },
    { index: 1, at: 112, file: 'b.jpg' },
    { index: 2, at: 150, file: 'c.jpg' },
  ]

  it('takes the last shot before the next frame starts, which holds what this frame painted', () => {
    expect(Option.map(shotOfFrame(shots, frames, 1), ({ file }) => file)).toEqual(
      Option.some('b.jpg'),
    )
    expect(Option.map(shotOfFrame(shots, frames, 2), ({ file }) => file)).toEqual(
      Option.some('c.jpg'),
    )
  })

  it('takes the last shot there is for the last frame', () => {
    expect(Option.map(shotOfFrame(shots, frames, 3), ({ file }) => file)).toEqual(
      Option.some('c.jpg'),
    )
  })

  it('has nothing to show before the first shot', () => {
    expect(shotOfFrame([], frames, 1)).toEqual(Option.none())
  })

  it('says how far the image is from its frame, since a screencast hole can hide a short state', () => {
    expect(imageWithItsAge(shots, frames, 2)).toBe('c.jpg (taken 33 ms after this frame)')
    expect(imageWithItsAge(shots, frames, 3)).toBe('c.jpg (taken 50 ms before this frame)')
    expect(imageWithItsAge([], frames, 1)).toBe(NO_IMAGE)
  })
})

describe('tileFrames', () => {
  it('keeps the frames where the marks changed and the ones a finding names', () => {
    const frames = [
      frameAt(1, 100, ['composer']),
      frameAt(2, 117, ['composer']),
      frameAt(3, 133, ['composer']),
      frameAt(4, 150, ['edge-card']),
      frameAt(5, 167, ['edge-card']),
    ]
    const flagged = flaggedFrames([
      {
        check: 'blank',
        key: 'blank',
        story: 'a story',
        firstFrame: 2,
        lastFrame: 2,
        imageFrame: 2,
        fromMs: 117,
        toMs: 117,
        marks: [],
        words: '',
      },
    ])

    expect(tileFrames(frames, flagged).map(({ frame }) => frame)).toEqual([1, 2, 4])
  })
})
