import { describe, expect, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import { CrookVersion, isBehind } from '@crook/domain/CrookVersion'

const version = (text: string) => CrookVersion.make(text)

describe('CrookVersion', () => {
  it('compares release numbers as numbers, not as text', () => {
    expect(isBehind(version('0.0.9'), version('0.1.0'))).toBe(true)
    expect(isBehind(version('0.9.0'), version('0.10.0'))).toBe(true)
    expect(isBehind(version('0.1.0'), version('0.1.0'))).toBe(false)
    expect(isBehind(version('1.0.0'), version('0.10.0'))).toBe(false)
  })

  it('accepts only three dot-separated release numbers', () => {
    expect(Result.isFailure(Schema.decodeResult(CrookVersion)('0.1'))).toBe(true)
    expect(Result.isFailure(Schema.decodeResult(CrookVersion)('0.1.0-beta'))).toBe(true)
  })
})
