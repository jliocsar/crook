import { describe, expect, it } from 'vitest'

import {
  CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY_DIRECTIVES,
} from '@/csp/ContentSecurityPolicy'

describe('CONTENT_SECURITY_POLICY', () => {
  it('allows no inline or evaluated code', () => {
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-|data:|blob:|\*/u)
  })

  it('serialises every directive once, in a header-ready string', () => {
    expect(CONTENT_SECURITY_POLICY.split('; ')).toHaveLength(
      Object.keys(CONTENT_SECURITY_POLICY_DIRECTIVES).length,
    )
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self'")
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'")
  })
})
