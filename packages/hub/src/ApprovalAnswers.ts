import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FiberMap from 'effect/FiberMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schedule from 'effect/Schedule'

import { commandAudit } from '@crook/domain/Audit'
import { AnswerAsk, Approve, type AskAnswer, Decline } from '@crook/domain/Command'
import { type AskId, type GlobalPaneId, IdempotencyKey } from '@crook/domain/Ids'
import type { CommandFailure } from '@crook/protocol/Commands'

import { AuditTrail } from '@crook/hub/AuditTrail'
import { CommandRouter } from '@crook/hub/CommandRouter'
import {
  type HarkApprovalState,
  HarkClient,
  gaveUpOnBug,
  pauseOrGiveUp,
} from '@crook/hub/HarkClient'
import { RECONNECT_GRACE } from '@crook/hub/Herd'
import { type SentNotification, notificationKey } from '@crook/hub/NotificationPlan'

type WaitedApproval = HarkApprovalState | 'abandoned'

const HARK_ACTOR = 'hark'

const isWorthRetrying = (failure: CommandFailure) =>
  Match.value(failure).pipe(
    Match.tag('MachineOffline', 'CommandTimedOut', () => true),
    Match.orElse(() => false),
  )

const answerOf = (state: WaitedApproval): Option.Option<AskAnswer> =>
  Match.value(state).pipe(
    Match.when('approved', () => Option.some<AskAnswer>(new Approve())),
    Match.when('denied', () => Option.some<AskAnswer>(new Decline({ message: Option.none() }))),
    Match.orElse(() => Option.none()),
  )

export const makeApprovalAnswers = Effect.gen(function* () {
  const hark = yield* HarkClient
  const router = yield* CommandRouter
  const audit = yield* AuditTrail
  const scope = yield* Effect.scope
  const waiters = yield* FiberMap.make<GlobalPaneId>()

  const routeAnswer = Effect.fn('ApprovalAnswers.routeAnswer')(function* (
    approval: SentNotification,
    ask: AskId,
    answer: AskAnswer,
  ) {
    const command = new AnswerAsk({ pane: approval.pane, ask, answer })
    const key = IdempotencyKey.make(approval.harkId)

    return yield* router.send(approval.machine, key, command).pipe(
      audit.audited({
        actor: HARK_ACTOR,
        machine: approval.machine,
        idempotencyKey: Option.some(key),
        ...commandAudit(command),
      }),
      Effect.forkIn(scope),
      Effect.flatMap(Fiber.join),
    )
  })

  const deliverAnswer = Effect.fn('ApprovalAnswers.deliverAnswer')(function* (
    approval: SentNotification,
    ask: AskId,
    answer: AskAnswer,
  ) {
    const what = `pane ${approval.pane} of machine ${approval.machine}`

    return yield* routeAnswer(approval, ask, answer).pipe(
      Effect.retry({ schedule: Schedule.spaced(RECONNECT_GRACE), while: isWorthRetrying }),
      Effect.andThen(Effect.logInfo(`Answered the approval of ${what} from the lock screen.`)),
      Effect.catch((failure) =>
        Effect.logError(
          `The answer given on the lock screen for ${what} did not reach the agent, so it stays unanswered unless it is answered in crook or on the laptop: ${failure.message}`,
        ),
      ),
    )
  })

  const pollApproval = Effect.fn('ApprovalAnswers.pollApproval')(function* (
    approval: SentNotification,
  ) {
    const what = `waiting for the answer to the approval of pane ${approval.pane} of machine ${approval.machine}`

    return yield* hark
      .awaitApproval(approval.harkId)
      .pipe(
        Effect.catch((failure) =>
          Effect.map(pauseOrGiveUp(what, failure), (after): WaitedApproval =>
            after === 'retry' ? 'pending' : 'abandoned',
          ),
        ),
      )
  })

  const awaitAnswer = Effect.fn('ApprovalAnswers.awaitAnswer')(function* (
    approval: SentNotification,
  ) {
    const state = yield* pollApproval(approval).pipe(
      Effect.repeat({ while: (waited) => waited === 'pending' }),
    )

    yield* Option.match(Option.all({ answer: answerOf(state), ask: approval.ask }), {
      onNone: () => Effect.void,
      onSome: ({ answer, ask }) => deliverAnswer(approval, ask, answer),
    })
  })

  const watch = (approval: SentNotification) =>
    FiberMap.run(
      waiters,
      notificationKey(approval),
      awaitAnswer(approval).pipe(
        Effect.catchDefect((defect) =>
          Effect.logError(gaveUpOnBug(`the approval of pane ${approval.pane}`), defect),
        ),
      ),
    )

  const cancel = Effect.fn('ApprovalAnswers.cancel')(function* (approval: SentNotification) {
    yield* FiberMap.remove(waiters, notificationKey(approval))
    yield* hark.cancel(approval.harkId)
  })

  return { watch, cancel }
})
