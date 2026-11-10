import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as DateTime from 'effect/DateTime'
import * as Deferred from 'effect/Deferred'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { commandAudit } from '@crook/domain/Audit'
import { AnswerAsk, Approve, type AskAnswer, Decline } from '@crook/domain/Command'
import { type AskId, IdempotencyKey, MachineId, type GlobalPaneId } from '@crook/domain/Ids'
import type { MachineState } from '@crook/domain/MachineState'
import { AskNotPending } from '@crook/protocol/Commands'

import {
  AnswerCommand,
  AnswerEvent,
  type AnswerFate,
  AnswerState,
  HARK_CLOSED,
  INCONCLUSIVE_FAILURES,
  POLLING,
  WITHDRAWN,
  approvalAnswerMachine,
} from '@crook/hub/ApprovalAnswerMachine'
import { AuditTrail } from '@crook/hub/AuditTrail'
import { CommandRouter, type LiveLink } from '@crook/hub/CommandRouter'
import {
  HARK_APPROVAL_EXPIRY,
  type HarkApprovalRead,
  HarkClient,
  type HarkId,
  gaveUpOnBug,
  pauseOrGiveUp,
} from '@crook/hub/HarkClient'
import { type SentNotification, notificationKey, verdictOn } from '@crook/hub/NotificationPlan'

interface AnswerRun {
  readonly harkId: HarkId
  readonly events: Queue.Queue<AnswerEvent>
  readonly pollingOver: Deferred.Deferred<void>
}

interface Judged {
  readonly live: LiveLink
  readonly movedOn: boolean
}

interface SendOrder {
  readonly attempt: number
  readonly answer: AskAnswer
  readonly link: number
}

const HARK_ACTOR = 'hark'
const ABANDONED_READ: HarkApprovalRead = { state: 'closed', respondedAt: Option.none() }
const PENDING_READ: HarkApprovalRead = { state: 'pending', respondedAt: Option.none() }

export class AnswerAgedOut extends Schema.TaggedError<AnswerAgedOut>()('AnswerAgedOut', {
  machine: MachineId,
  held: Schema.DurationFromMillis,
}) {
  override get message(): string {
    return `Machine "${this.machine}" stayed away for ${Duration.format(this.held)} after the answer, the time a prompt stays open on the lock screen, so the hub stopped holding it. Answer the agent in crook or on the laptop once the machine is back.`
  }
}

const answerOf = (read: HarkApprovalRead): Option.Option<AskAnswer> =>
  Match.value(read.state).pipe(
    Match.when('approved', () => Option.some<AskAnswer>(new Approve())),
    Match.when('denied', () => Option.some<AskAnswer>(new Decline({ message: Option.none() }))),
    Match.orElse(() => Option.none()),
  )

const makeAnswerReader = Effect.gen(function* () {
  const hark = yield* HarkClient
  const audit = yield* AuditTrail

  const pollApproval = Effect.fn('ApprovalAnswers.pollApproval')(function* (
    approval: SentNotification,
  ) {
    const what = `waiting for the answer to the approval of pane ${approval.pane} of machine ${approval.machine}`

    return yield* hark
      .awaitApproval(approval.harkId)
      .pipe(
        Effect.catch((failure) =>
          Effect.map(pauseOrGiveUp(what, failure), (after) =>
            after === 'retry' ? PENDING_READ : ABANDONED_READ,
          ),
        ),
      )
  })

  const hasConcluded = (key: IdempotencyKey) =>
    audit
      .hasConcluded(key, INCONCLUSIVE_FAILURES)
      .pipe(
        Effect.catchTag('SqlError', (error) =>
          Effect.logWarning(
            `The hub could not read the audit entries of answer ${key}, so it holds the answer as if none had concluded: ${error.message}. Check the disk and the file at CROOK_HUB_DATABASE_PATH.`,
          ).pipe(Effect.as(false)),
        ),
      )

  const eventOfAnswer = Effect.fn('ApprovalAnswers.eventOfAnswer')(function* (
    approval: SentNotification,
    read: HarkApprovalRead,
    answer: AskAnswer,
  ) {
    if (yield* hasConcluded(IdempotencyKey.make(approval.harkId))) {
      return HARK_CLOSED
    }

    const heldFrom = yield* Option.match(read.respondedAt, {
      onNone: () => Clock.currentTimeMillis,
      onSome: (respondedAt) => Effect.succeed(DateTime.toEpochMillis(respondedAt)),
    })

    return AnswerEvent.cases.HarkAnswered.make({
      answer,
      deadline: heldFrom + Duration.toMillis(HARK_APPROVAL_EXPIRY),
    })
  })

  return Effect.fn('ApprovalAnswers.awaitAnswer')(function* (approval: SentNotification) {
    const read = yield* pollApproval(approval).pipe(
      Effect.repeat({ while: (waited) => waited.state === 'pending' }),
    )

    return yield* Option.match(answerOf(read), {
      onNone: () => Effect.succeed(HARK_CLOSED),
      onSome: (answer) => eventOfAnswer(approval, read, answer),
    })
  })
})

const judgedOn = (
  approval: SentNotification,
  triedAgainst: Option.Option<MachineState>,
  live: LiveLink,
): Option.Option<Judged> =>
  Match.value(verdictOn(approval, live.state)).pipe(
    Match.when('movedOn', () => Option.some({ live, movedOn: true })),
    Match.when('raised', () =>
      Option.liftPredicate(
        { live, movedOn: false },
        () => !Option.exists(triedAgainst, (tried) => tried === live.state),
      ),
    ),
    Match.orElse(() => Option.none()),
  )

const makeHold = Effect.gen(function* () {
  const router = yield* CommandRouter

  const nextJudgement = (
    approval: SentNotification,
    triedAgainst: Option.Option<MachineState>,
  ): Effect.Effect<Judged> =>
    router.liveLink(approval.machine).pipe(
      Stream.map(Option.flatMap((live) => judgedOn(approval, triedAgainst, live))),
      Stream.filter(Option.isSome),
      Stream.map((judged) => judged.value),
      Stream.runHead,
      Effect.flatMap(Option.match({ onNone: () => Effect.never, onSome: Effect.succeed })),
    )

  return Effect.fn('ApprovalAnswers.hold')(function* (
    approval: SentNotification,
    triedAgainst: Ref.Ref<Option.Option<MachineState>>,
    attempt: number,
    deadline: number,
  ) {
    const left = deadline - (yield* Clock.currentTimeMillis)
    const agedOut = AnswerEvent.cases.DeadlinePassed.make({ attempt })

    if (left <= 0) {
      return agedOut
    }

    const judged = yield* nextJudgement(approval, yield* Ref.get(triedAgainst)).pipe(
      Effect.asSome,
      Effect.raceFirst(Effect.as(Effect.sleep(Duration.millis(left)), Option.none<Judged>())),
    )

    if (Option.isNone(judged)) {
      return agedOut
    }

    if (judged.value.movedOn) {
      return AnswerEvent.cases.AskMovedOn.make({ attempt })
    }

    yield* Ref.set(triedAgainst, Option.some(judged.value.live.state))

    return AnswerEvent.cases.AskOpen.make({ attempt, link: judged.value.live.link })
  })
})

export const makeApprovalAnswers = Effect.gen(function* () {
  const hark = yield* HarkClient
  const router = yield* CommandRouter
  const audit = yield* AuditTrail
  const scope = yield* Effect.scope
  const awaitAnswer = yield* makeAnswerReader
  const hold = yield* makeHold
  const runs = yield* Ref.make(HashMap.empty<GlobalPaneId, AnswerRun>())

  const send = Effect.fn('ApprovalAnswers.send')(function* (
    approval: SentNotification,
    ask: AskId,
    { attempt, answer, link }: SendOrder,
  ) {
    const command = new AnswerAsk({ pane: approval.pane, ask, answer })
    const failure = yield* router
      .sendOver(approval.machine, link, IdempotencyKey.make(approval.harkId), command)
      .pipe(Effect.as(Option.none()), Effect.catch(Effect.succeedSome))

    return AnswerEvent.cases.SendFinished.make({ attempt, failure })
  })

  const record = (approval: SentNotification, ask: AskId, answer: AskAnswer, fate: AnswerFate) => {
    const what = `pane ${approval.pane} of machine ${approval.machine}`
    const outcome = Match.value(fate).pipe(
      Match.tagsExhaustive({
        Delivered: () => Effect.void,
        Failed: ({ failure }) => Effect.fail(failure),
        NoLongerAsked: () => Effect.fail(new AskNotPending({ pane: approval.pane, ask })),
        AgedOut: () =>
          Effect.fail(new AnswerAgedOut({ machine: approval.machine, held: HARK_APPROVAL_EXPIRY })),
      }),
    )

    return outcome.pipe(
      audit.audited({
        actor: HARK_ACTOR,
        machine: approval.machine,
        idempotencyKey: Option.some(IdempotencyKey.make(approval.harkId)),
        ...commandAudit(new AnswerAsk({ pane: approval.pane, ask, answer })),
      }),
      Effect.andThen(Effect.logInfo(`Answered the approval of ${what} from the lock screen.`)),
      Effect.catch((failure) =>
        Effect.logError(
          `The answer given on the lock screen for ${what} has no delivery the hub knows of, so unless it landed unconfirmed the agent stays unanswered until it is answered in crook or on the laptop: ${failure.message}`,
        ),
      ),
      Effect.uninterruptible,
    )
  }

  const driveRun = Effect.fn('ApprovalAnswers.driveRun')(function* (
    approval: SentNotification,
    ask: AskId,
    run: AnswerRun,
  ) {
    const triedAgainst = yield* Ref.make(Option.none<MachineState>())
    const state = yield* Ref.make<AnswerState>(POLLING)

    const feed = (work: Effect.Effect<AnswerEvent>) =>
      work.pipe(
        Effect.flatMap((event) => Queue.offer(run.events, event)),
        Effect.catchDefect((defect) => Queue.failCause(run.events, Cause.die(defect))),
        Effect.forkScoped,
      )

    const runCommand = (command: AnswerCommand) =>
      AnswerCommand.$match(command, {
        Poll: () =>
          feed(
            awaitAnswer(approval).pipe(
              Effect.ensuring(Deferred.succeed(run.pollingOver, undefined)),
            ),
          ),
        Hold: ({ attempt, deadline }) => feed(hold(approval, triedAgainst, attempt, deadline)),
        Send: (order) => feed(send(approval, ask, order)),
        Record: ({ answer, fate }) => record(approval, ask, answer, fate),
      })

    const step = Effect.gen(function* () {
      const event = yield* Queue.take(run.events)
      const current = yield* Ref.get(state)
      const [next, commands] = approvalAnswerMachine.transition(current, event)

      yield* Ref.set(state, next)
      yield* Effect.forEach(commands, runCommand, { discard: true })

      return next
    })

    yield* runCommand(AnswerCommand.Poll())
    yield* step.pipe(Effect.repeat({ until: AnswerState.guards.Ended }))
  }, Effect.scoped)

  const forget = (approval: SentNotification, run: AnswerRun) =>
    Ref.update(
      runs,
      HashMap.modifyAt(
        notificationKey(approval),
        Option.filter((current) => current !== run),
      ),
    ).pipe(Effect.andThen(Deferred.succeed(run.pollingOver, undefined)))

  const start = Effect.fn('ApprovalAnswers.start')(function* (
    approval: SentNotification,
    ask: AskId,
  ) {
    const run: AnswerRun = {
      harkId: approval.harkId,
      events: yield* Queue.unbounded<AnswerEvent>(),
      pollingOver: yield* Deferred.make<void>(),
    }
    const previous = yield* Ref.modify(runs, (current) => [
      HashMap.get(current, notificationKey(approval)),
      HashMap.set(current, notificationKey(approval), run),
    ])

    yield* Option.match(previous, {
      onNone: () => Effect.void,
      onSome: (replaced) => Queue.offer(replaced.events, WITHDRAWN),
    })
    yield* driveRun(approval, ask, run).pipe(
      Effect.catchDefect((defect) =>
        Effect.logError(gaveUpOnBug(`the approval of pane ${approval.pane}`), defect),
      ),
      Effect.ensuring(forget(approval, run)),
      Effect.forkIn(scope),
    )
  })

  const watch = (approval: SentNotification) =>
    Option.match(approval.ask, {
      onNone: () => Effect.void,
      onSome: (ask) => start(approval, ask),
    })

  const cancel = Effect.fn('ApprovalAnswers.cancel')(function* (approval: SentNotification) {
    const run = HashMap.get(yield* Ref.get(runs), notificationKey(approval)).pipe(
      Option.filter((found) => found.harkId === approval.harkId),
    )

    yield* Option.match(run, {
      onNone: () => Effect.void,
      onSome: (found) =>
        Queue.offer(found.events, WITHDRAWN).pipe(
          Effect.andThen(Deferred.await(found.pollingOver)),
        ),
    })
    yield* hark.cancel(approval.harkId)
  })

  return { watch, cancel }
})
