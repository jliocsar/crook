import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { to } from '@crook/web/machine/Machine'
import type { Machine, Step } from '@crook/web/machine/Machine'

export const ComposerFailureState = Schema.TaggedUnion({
  NoFailure: {},
  PromptFailed: { message: Schema.String, text: Schema.String },
  StopFailed: { message: Schema.String },
})
export type ComposerFailureState = typeof ComposerFailureState.Type

export const ComposerFailureEvent = Schema.TaggedUnion({
  PromptRefused: { message: Schema.String, text: Schema.String },
  StopRefused: { message: Schema.String },
  PromptSent: {},
  StopPressed: {},
  DraftChanged: { draft: Schema.String },
  TurnEnded: {},
})
export type ComposerFailureEvent = typeof ComposerFailureEvent.Type

export const NO_FAILURE = ComposerFailureState.cases.NoFailure.make({})
export const PROMPT_SENT = ComposerFailureEvent.cases.PromptSent.make({})
export const STOP_PRESSED = ComposerFailureEvent.cases.StopPressed.make({})
export const TURN_ENDED = ComposerFailureEvent.cases.TurnEnded.make({})

export const promptRefused = (message: string, text: string) =>
  ComposerFailureEvent.cases.PromptRefused.make({ message, text })
export const stopRefused = (message: string) =>
  ComposerFailureEvent.cases.StopRefused.make({ message })
export const draftChanged = (draft: string) =>
  ComposerFailureEvent.cases.DraftChanged.make({ draft })

export const composerFailureMessage = (state: ComposerFailureState): Option.Option<string> =>
  ComposerFailureState.guards.NoFailure(state) ? Option.none() : Option.some(state.message)

const composerFailureTransition = (
  state: ComposerFailureState,
  event: ComposerFailureEvent,
): Step<ComposerFailureState> =>
  Match.value(event).pipe(
    Match.withReturnType<Step<ComposerFailureState>>(),
    Match.tagsExhaustive({
      PromptRefused: ({ message, text }) =>
        to(ComposerFailureState.cases.PromptFailed.make({ message, text })),
      StopRefused: ({ message }) => to(ComposerFailureState.cases.StopFailed.make({ message })),
      PromptSent: () => to(NO_FAILURE),
      StopPressed: () => to(ComposerFailureState.guards.StopFailed(state) ? NO_FAILURE : state),
      DraftChanged: ({ draft }) =>
        to(
          ComposerFailureState.guards.PromptFailed(state) && state.text !== draft
            ? NO_FAILURE
            : state,
        ),
      TurnEnded: () => to(ComposerFailureState.guards.StopFailed(state) ? NO_FAILURE : state),
    }),
  )

export const composerFailureMachine: Machine<ComposerFailureState, ComposerFailureEvent> = {
  name: 'composer-failure',
  states: ComposerFailureState,
  events: ComposerFailureEvent,
  initial: NO_FAILURE,
  transition: composerFailureTransition,
}
