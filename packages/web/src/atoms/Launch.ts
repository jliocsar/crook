import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import * as Schema from 'effect/Schema'

import { AgentStarted } from '@crook/domain/Command'
import type { LaunchCommand } from '@crook/domain/Command'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import type { SendCommandFailure } from '@crook/web/atoms/ActionFailure'
import { progressOf } from '@crook/web/atoms/ActionProgress'
import { herdViewAtom } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { boundedProgressAtom, SentBound } from '@crook/web/atoms/SentBound'
import { startedAgent } from '@crook/web/newagent/NewAgentLayout'
import { HubLink } from '@crook/web/rpc/HubLink'

export type LaunchFailure = SendCommandFailure | LaunchAnsweredWithoutPane

export class LaunchAttempt extends Data.Class<{
  readonly key: IdempotencyKey
  readonly machine: MachineId
  readonly command: LaunchCommand
}> {}

export class LaunchAnsweredWithoutPane extends Schema.TaggedError<LaunchAnsweredWithoutPane>()(
  'LaunchAnsweredWithoutPane',
  {},
) {
  override get message(): string {
    return 'The hub answered the start with a receipt that names no new pane, so crook cannot open its chat. Look for the new agent on the Agents tab; if this keeps happening, reload crook so it matches the build the hub serves.'
  }
}

const isAgentStarted = Schema.is(AgentStarted)

export const launchAtom = Atom.family((_key: IdempotencyKey) =>
  hubRuntime
    .fn((attempt: LaunchAttempt) =>
      HubLink.use((link) =>
        link
          .sendCommand(attempt.machine, attempt.key, attempt.command)
          .pipe(Effect.filterOrFail(isAgentStarted, () => new LaunchAnsweredWithoutPane())),
      ),
    )
    .pipe(Atom.keepAlive),
)

export const launchProgressAtom = Atom.family((attempt: LaunchAttempt) =>
  boundedProgressAtom({
    result: launchAtom(attempt.key),
    progress: (get) =>
      progressOf(get(launchAtom(attempt.key)), (agent) =>
        Option.exists(get(herdViewAtom), (view) =>
          Option.isSome(startedAgent(view, attempt.machine, agent)),
        ),
      ),
    bound: SentBound,
  }),
)
