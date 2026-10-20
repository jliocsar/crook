import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'

import { shortElapsed } from '@crook/web/time/Elapsed'

import { START } from '../HerdFixtures.ts'

const ago = (elapsed: Duration.Duration) =>
  shortElapsed(START, DateTime.subtractDuration(START, elapsed))

describe('shortElapsed', () => {
  it('counts in the largest whole unit', () => {
    expect(ago(Duration.seconds(42))).toBe('42s')
    expect(ago(Duration.minutes(3))).toBe('3m')
    expect(ago(Duration.minutes(150))).toBe('2h')
    expect(ago(Duration.hours(50))).toBe('2d')
  })

  it('never goes negative when the clocks disagree', () => {
    expect(shortElapsed(START, DateTime.addDuration(START, Duration.seconds(5)))).toBe('0s')
  })
})
