import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

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

export const keyToRetry = <Attempt extends { readonly key: IdempotencyKey }>(
  previous: Option.Option<Attempt>,
  retriable: (attempt: Attempt) => boolean,
): Option.Option<IdempotencyKey> =>
  pipe(
    previous,
    Option.filter(retriable),
    Option.map((attempt) => attempt.key),
  )
