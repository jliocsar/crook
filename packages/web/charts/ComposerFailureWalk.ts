import {
  ComposerFailureEvent,
  composerFailureMachine,
  composerFailureMessage,
  ComposerFailureState,
  draftChanged,
  PROMPT_SENT,
  promptRefused,
  STOP_PRESSED,
  stopRefused,
  TURN_ENDED,
} from '@crook/web/chat/ComposerFailureMachine'
import { caseName } from '@crook/web/machine/Machine'
import type { WalkSpec } from '@crook/web/machine/Walk'
import * as Option from 'effect/Option'

const REFUSAL = 'Refused.'
const FAILED_TEXT = 'Fix the banner'
const OTHER_DRAFT = 'Fix the banner too'

export const composerFailureWalk: WalkSpec<ComposerFailureState, ComposerFailureEvent, never> = {
  machine: composerFailureMachine,
  events: () => [
    promptRefused(REFUSAL, FAILED_TEXT),
    stopRefused(REFUSAL),
    PROMPT_SENT,
    STOP_PRESSED,
    draftChanged(FAILED_TEXT),
    draftChanged(OTHER_DRAFT),
    TURN_ENDED,
  ],
  home: ComposerFailureState.guards.NoFailure,
  identity: (state) => caseName(ComposerFailureState, state),
  invariants: [
    {
      name: 'a failure says why',
      holds: (state) =>
        ComposerFailureState.guards.NoFailure(state) ||
        Option.contains(composerFailureMessage(state), REFUSAL),
    },
  ],
  arrowRules: [
    {
      name: 'the draft a failed prompt restores does not clear its failure',
      holds: ({ from, event, to }) =>
        !ComposerFailureState.guards.PromptFailed(from) ||
        !ComposerFailureEvent.guards.DraftChanged(event) ||
        event.draft !== from.text ||
        ComposerFailureState.guards.PromptFailed(to),
    },
    {
      name: 'editing the draft says nothing about a stop that failed',
      holds: ({ from, event, to }) =>
        !ComposerFailureState.guards.StopFailed(from) ||
        !ComposerFailureEvent.guards.DraftChanged(event) ||
        ComposerFailureState.guards.StopFailed(to),
    },
    {
      name: 'a turn that ends leaves no failed stop behind',
      holds: ({ event, to }) =>
        !ComposerFailureEvent.guards.TurnEnded(event) ||
        !ComposerFailureState.guards.StopFailed(to),
    },
    {
      name: 'the next send clears whatever was showing',
      holds: ({ event, to }) =>
        !ComposerFailureEvent.guards.PromptSent(event) || ComposerFailureState.guards.NoFailure(to),
    },
  ],
}
