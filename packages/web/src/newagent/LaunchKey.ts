import * as Equal from 'effect/Equal'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import type { LaunchCommand } from '@crook/domain/Command'
import { IdempotencyKey } from '@crook/domain/Ids'
import type { MachineId } from '@crook/domain/Ids'
import type { LaunchAttempt, LaunchFailure } from '@crook/web/atoms/Launch'

const KEY_BYTES = 16
const HEX_RADIX = 16
const HEX_DIGITS_PER_BYTE = 2

const remembersOutcome = (failure: LaunchFailure): boolean =>
  Match.value(failure).pipe(
    Match.tags({
      AgentNotStarted: () => true,
      TaskNotDelivered: () => true,
      CommandDeliveryUnknown: () => true,
      LaunchAnsweredWithoutPane: () => true,
    }),
    Match.orElse(() => false),
  )

export const retryKey = (
  previous: Option.Option<LaunchAttempt>,
  failure: Option.Option<LaunchFailure>,
  machine: MachineId,
  command: LaunchCommand,
): Option.Option<IdempotencyKey> =>
  pipe(
    previous,
    Option.filter(
      (attempt) =>
        attempt.machine === machine &&
        Equal.equals(attempt.command, command) &&
        Option.exists(failure, (reason) => !remembersOutcome(reason)),
    ),
    Option.map((attempt) => attempt.key),
  )

export const mintIdempotencyKey = (): IdempotencyKey =>
  IdempotencyKey.make(
    Array.from(crypto.getRandomValues(new Uint8Array(KEY_BYTES)), (byte) =>
      byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0'),
    ).join(''),
  )
