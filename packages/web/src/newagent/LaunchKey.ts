import * as Equal from 'effect/Equal'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import type { LaunchCommand } from '@crook/domain/Command'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import { remembersOutcome } from '@crook/web/atoms/ActionFailure'
import type { LaunchAttempt, LaunchFailure } from '@crook/web/atoms/Launch'

const remembersLaunch = (failure: LaunchFailure): boolean =>
  Match.value(failure).pipe(
    Match.tag('LaunchAnsweredWithoutPane', () => true),
    Match.orElse(remembersOutcome),
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
        Option.exists(failure, (reason) => !remembersLaunch(reason)),
    ),
    Option.map((attempt) => attempt.key),
  )
