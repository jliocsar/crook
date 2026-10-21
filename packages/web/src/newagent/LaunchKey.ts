import * as Equal from 'effect/Equal'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import type { LaunchCommand } from '@crook/domain/Command'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import type { LaunchAttempt, LaunchFailure } from '@crook/web/atoms/Launch'

const remembersOutcome = (failure: LaunchFailure): boolean =>
  Match.value(failure).pipe(
    Match.tagsExhaustive({
      AgentNotStarted: () => true,
      TaskNotDelivered: () => true,
      CommandDeliveryUnknown: () => true,
      LaunchAnsweredWithoutPane: () => true,
      FolderNotFound: () => false,
      FolderUnreadable: () => false,
      FolderNotCheckout: () => false,
      HerdrRefusedCommand: () => false,
      HerdrUnavailable: () => false,
      HerdrAnswerUnreadable: () => false,
      PaneNotAgent: () => false,
      PaneNotCreatedByCrook: () => false,
      AskNotPending: () => false,
      AskDialogUnreadable: () => false,
      AskOptionUnavailable: () => false,
      QuestionnaireUnsupported: () => false,
      DeclineMessageUndelivered: () => false,
      MachineOffline: () => false,
      CommandTimedOut: () => false,
      HubConnectionLost: () => false,
      HubCallDefected: () => false,
      HubNotConnected: () => false,
    }),
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
