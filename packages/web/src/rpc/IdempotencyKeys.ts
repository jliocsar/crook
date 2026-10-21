import { IdempotencyKey } from '@crook/domain/Ids'

const KEY_BYTES = 16
const HEX_RADIX = 16
const HEX_DIGITS_PER_BYTE = 2

export const mintIdempotencyKey = (): IdempotencyKey =>
  IdempotencyKey.make(
    Array.from(crypto.getRandomValues(new Uint8Array(KEY_BYTES)), (byte) =>
      byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0'),
    ).join(''),
  )
