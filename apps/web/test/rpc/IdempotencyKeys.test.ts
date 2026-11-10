import { describe, expect, it } from '@effect/vitest'

import { mintIdempotencyKey } from '@crook/web/rpc/IdempotencyKeys'

describe('mintIdempotencyKey', () => {
  it('mints a fresh 128-bit hex key each time', () => {
    const first = mintIdempotencyKey()

    expect(first).toMatch(/^[0-9a-f]{32}$/u)
    expect(mintIdempotencyKey()).not.toBe(first)
  })
})
