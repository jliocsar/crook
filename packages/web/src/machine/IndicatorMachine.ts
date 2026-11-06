import * as Data from 'effect/Data'
import type * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Schema from 'effect/Schema'

import { to } from '@crook/state-machine/Machine'
import type { Machine, Step } from '@crook/state-machine/Machine'
import { NOTICE_DELAY, NOTICE_HOLD } from '@crook/web/machine/NoticeTiming'

export type IndicatorCommand = Data.TaggedEnum<{
  WaitOutDelay: { readonly attempt: number }
  WaitOutHold: { readonly attempt: number }
  WaitOutFade: { readonly attempt: number }
}>

type IndicatorStep = Step<IndicatorState, IndicatorCommand>

export const IndicatorState = Schema.TaggedUnion({
  Hidden: { attempt: Schema.Int },
  Delaying: { attempt: Schema.Int },
  Holding: { attempt: Schema.Int },
  Showing: { attempt: Schema.Int },
  Lingering: { attempt: Schema.Int },
  Leaving: { attempt: Schema.Int },
})
export type IndicatorState = typeof IndicatorState.Type

export const IndicatorEvent = Schema.TaggedUnion({
  Began: {},
  Ended: {},
  DelayEnded: { attempt: Schema.Int },
  HoldEnded: { attempt: Schema.Int },
  FadeEnded: { attempt: Schema.Int },
})
export type IndicatorEvent = typeof IndicatorEvent.Type

const FIRST_ATTEMPT = 0

export const INDICATOR_BEGAN = IndicatorEvent.cases.Began.make({})
export const INDICATOR_ENDED = IndicatorEvent.cases.Ended.make({})
export const INDICATOR_HIDDEN = IndicatorState.cases.Hidden.make({ attempt: FIRST_ATTEMPT })

export const IndicatorCommand = Data.taggedEnum<IndicatorCommand>()

export const delayEnded = (attempt: number) => IndicatorEvent.cases.DelayEnded.make({ attempt })
export const holdEnded = (attempt: number) => IndicatorEvent.cases.HoldEnded.make({ attempt })
export const fadeEnded = (attempt: number) => IndicatorEvent.cases.FadeEnded.make({ attempt })

export const isIndicatorShown = IndicatorState.isAnyOf([
  'Holding',
  'Showing',
  'Lingering',
  'Leaving',
])

const indicatorTransition = (state: IndicatorState, event: IndicatorEvent): IndicatorStep => {
  const { attempt } = state
  const leaving: IndicatorStep = [
    IndicatorState.cases.Leaving.make({ attempt }),
    [IndicatorCommand.WaitOutFade({ attempt })],
  ]

  return Match.value(event).pipe(
    Match.withReturnType<IndicatorStep>(),
    Match.tagsExhaustive({
      Began: () =>
        Match.value(state).pipe(
          Match.withReturnType<IndicatorStep>(),
          Match.tag('Hidden', () => {
            const next = attempt + 1

            return [
              IndicatorState.cases.Delaying.make({ attempt: next }),
              [IndicatorCommand.WaitOutDelay({ attempt: next })],
            ]
          }),
          Match.tag('Lingering', () => to(IndicatorState.cases.Holding.make({ attempt }))),
          Match.tag('Leaving', () =>
            to(IndicatorState.cases.Showing.make({ attempt: attempt + 1 })),
          ),
          Match.orElse(() => to(state)),
        ),
      Ended: () =>
        Match.value(state).pipe(
          Match.withReturnType<IndicatorStep>(),
          Match.tag('Delaying', () => to(IndicatorState.cases.Hidden.make({ attempt }))),
          Match.tag('Holding', () => to(IndicatorState.cases.Lingering.make({ attempt }))),
          Match.tag('Showing', () => leaving),
          Match.orElse(() => to(state)),
        ),
      DelayEnded: (ended) =>
        IndicatorState.guards.Delaying(state) && ended.attempt === attempt
          ? [
              IndicatorState.cases.Holding.make({ attempt }),
              [IndicatorCommand.WaitOutHold({ attempt })],
            ]
          : to(state),
      HoldEnded: (ended) => {
        if (ended.attempt !== attempt) {
          return to(state)
        }

        return Match.value(state).pipe(
          Match.withReturnType<IndicatorStep>(),
          Match.tag('Holding', () => to(IndicatorState.cases.Showing.make({ attempt }))),
          Match.tag('Lingering', () => leaving),
          Match.orElse(() => to(state)),
        )
      },
      FadeEnded: (ended) =>
        to(
          IndicatorState.guards.Leaving(state) && ended.attempt === attempt
            ? IndicatorState.cases.Hidden.make({ attempt })
            : state,
        ),
    }),
  )
}

export const indicatorMachine: Machine<IndicatorState, IndicatorEvent, IndicatorCommand> = {
  name: 'indicator',
  states: IndicatorState,
  events: IndicatorEvent,
  initial: INDICATOR_HIDDEN,
  transition: indicatorTransition,
}

export const indicatorTimer = (
  fade: Duration.Duration,
): ((command: IndicatorCommand) => Effect.Effect<IndicatorEvent>) =>
  IndicatorCommand.$match({
    WaitOutDelay: ({ attempt }) => Effect.as(Effect.sleep(NOTICE_DELAY), delayEnded(attempt)),
    WaitOutHold: ({ attempt }) => Effect.as(Effect.sleep(NOTICE_HOLD), holdEnded(attempt)),
    WaitOutFade: ({ attempt }) => Effect.as(Effect.sleep(fade), fadeEnded(attempt)),
  })
