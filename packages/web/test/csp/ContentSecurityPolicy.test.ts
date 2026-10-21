import { describe, expect, it } from 'vitest'

import {
  CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_DIRECTIVES,
} from '@crook/web/csp/ContentSecurityPolicy'

describe('CONTENT_SECURITY_POLICY', () => {
  it('allows no inline or evaluated code', () => {
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-|data:|\*/u)
  })

  it('admits blob URLs for images and nothing else', () => {
    const withBlob = Object.entries(CONTENT_SECURITY_POLICY_DIRECTIVES)
      .filter(([, sources]) => sources.some((source) => source === 'blob:'))
      .map(([directive]) => directive)

    expect(withBlob).toStrictEqual(['img-src'])
  })

  it('serialises every directive once, in a header-ready string', () => {
    expect(CONTENT_SECURITY_POLICY.split('; ')).toHaveLength(
      Object.keys(CONTENT_SECURITY_POLICY_DIRECTIVES).length,
    )
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'")
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'")
  })
})
