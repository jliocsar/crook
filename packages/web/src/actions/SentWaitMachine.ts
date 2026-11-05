import * as Clock from 'effect/Clock'
import * as Data from 'effect/Data'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Schema from 'effect/Schema'

import { to } from '@crook/web/machine/Machine'
import type { Machine, Step } from '@crook/web/machine/Machine'

export type SentWaitCommand = Data.TaggedEnum<{
  WaitOutBound: { readonly answeredAt: number }
}>

type SentWaitStep = Step<SentWaitState, SentWaitCommand>

export const SentWaitState = Schema.TaggedUnion({
  NotSent: {},
  Awaiting: { answeredAt: Schema.Finite },
  Unconfirmed: { answeredAt: Schema.Finite },
})
export type SentWaitState = typeof SentWaitState.Type

export const SentWaitEvent = Schema.TaggedUnion({
  Answered: { answeredAt: Schema.Finite },
  Settled: {},
  BoundEnded: { answeredAt: Schema.Finite },
})
export type SentWaitEvent = typeof SentWaitEvent.Type

const SOONEST_WAKE_MS = 1

export const NOT_SENT = SentWaitState.cases.NotSent.make({})
export const SETTLED = SentWaitEvent.cases.Settled.make({})

export const SentWaitCommand = Data.taggedEnum<SentWaitCommand>()

export const answered = (answeredAt: number) => SentWaitEvent.cases.Answered.make({ answeredAt })
export const boundEnded = (answeredAt: number) =>
  SentWaitEvent.cases.BoundEnded.make({ answeredAt })

const sentWaitTransition = (state: SentWaitState, event: SentWaitEvent): SentWaitStep =>
  Match.value(event).pipe(
    Match.withReturnType<SentWaitStep>(),
    Match.tagsExhaustive({
      Settled: () => to(NOT_SENT),
      Answered: ({ answeredAt }) =>
        !SentWaitState.guards.NotSent(state) && state.answeredAt === answeredAt
          ? to(state)
          : [
              SentWaitState.cases.Awaiting.make({ answeredAt }),
              [SentWaitCommand.WaitOutBound({ answeredAt })],
            ],
      BoundEnded: ({ answeredAt }) =>
        to(
          SentWaitState.guards.Awaiting(state) && state.answeredAt === answeredAt
            ? SentWaitState.cases.Unconfirmed.make({ answeredAt })
            : state,
        ),
    }),
  )

export const sentWaitMachine: Machine<SentWaitState, SentWaitEvent, SentWaitCommand> = {
  name: 'sent-wait',
  states: SentWaitState,
  events: SentWaitEvent,
  initial: NOT_SENT,
  transition: sentWaitTransition,
}

export const sentWaitTimer = (
  bound: Duration.Duration,
): ((command: SentWaitCommand) => Effect.Effect<SentWaitEvent>) =>
  SentWaitCommand.$match({
    WaitOutBound: ({ answeredAt }) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.as(
          Effect.sleep(
            Duration.millis(
              Math.max(SOONEST_WAKE_MS, Duration.toMillis(bound) - (now - answeredAt)),
            ),
          ),
          boundEnded(answeredAt),
        ),
      ),
  })
