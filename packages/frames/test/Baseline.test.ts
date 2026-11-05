import { describe, expect, it } from '@effect/vitest'
import * as Schema from 'effect/Schema'

import { Baseline, isClean, verdictOf } from '@crook/frames/Baseline'
import type { Finding } from '@crook/frames/Detect'
import { TIMELINE_STORY_IDS } from '@crook/frames/Expectations'
import { verdictLines } from '@crook/frames/Report'

import baselineJson from '../baseline.json' with { type: 'json' }

const STORY = 'transition/machine-redial'

const finding = (key: string): Finding => ({
  check: 'flash',
  key,
  story: STORY,
  firstFrame: 12,
  lastFrame: 14,
  imageFrame: 13,
  fromMs: 300,
  toMs: 350,
  marks: ['composer'],
  words: 'It flashed.',
})

const imageOf = (frame: number): string => `/shots/${frame}.jpg`

describe('verdictOf', () => {
  it('fails on a finding the baseline does not know', () => {
    const verdict = verdictOf(STORY, [finding('flash:composer')], {})

    expect(isClean(verdict)).toBe(false)
    expect(verdict.fresh.map(({ key }) => key)).toEqual(['flash:composer'])
  })

  it('passes on a finding the baseline knows', () => {
    const verdict = verdictOf(STORY, [finding('flash:composer')], {
      [STORY]: { always: ['flash:composer'] },
    })

    expect(isClean(verdict)).toBe(true)
    expect(verdict.known.map(({ key }) => key)).toEqual(['flash:composer'])
  })

  it('fails when a known finding no longer happens, and says to remove it', () => {
    const verdict = verdictOf(STORY, [], { [STORY]: { always: ['flash:composer'] } })
    const lines = verdictLines(verdict, imageOf, '/sheet.png')

    expect(isClean(verdict)).toBe(false)
    expect(verdict.gone).toEqual(['flash:composer'])
    expect(lines[0]).toBe(`FAIL ${STORY}`)
    expect(lines.join('\n')).toContain(
      'FIXED flash:composer no longer happens here. Remove it from this story in packages/frames/baseline.json.',
    )
  })

  it('neither needs nor refuses a finding only some runs show', () => {
    const baseline = { [STORY]: { always: [], sometimes: ['flash:composer'] } }

    expect(isClean(verdictOf(STORY, [], baseline))).toBe(true)
    expect(isClean(verdictOf(STORY, [finding('flash:composer')], baseline))).toBe(true)
  })
})

describe('verdictLines', () => {
  it('says the story, the frames, the times, the marks and where the image is', () => {
    const lines = verdictLines(
      verdictOf(STORY, [finding('flash:composer')], {}),
      imageOf,
      '/sheet.png',
    )

    expect(lines).toEqual([
      `FAIL ${STORY}`,
      '  NEW flash:composer',
      '    It flashed.',
      '    Frames 12 to 14, 300 ms to 350 ms after the page started.',
      '    On screen then: composer',
      '    Frame image (frame 13): /shots/13.jpg',
      '  Contact sheet: /sheet.png',
    ])
  })
})

describe('the checked-in baseline', () => {
  it('decodes, and names only stories the tool plays', () => {
    const baseline = Schema.decodeSync(Baseline)(baselineJson)

    expect(TIMELINE_STORY_IDS).toEqual(expect.arrayContaining(Object.keys(baseline)))
  })
})
