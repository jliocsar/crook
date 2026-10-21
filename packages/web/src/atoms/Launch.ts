import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

import { AgentStarted } from '@crook/domain/Command'
import type { LaunchCommand } from '@crook/domain/Command'
import type { IdempotencyKey, MachineId } from '@crook/domain/Ids'
import type { CommandFailure } from '@crook/protocol/Commands'
import { hubRuntime } from '@crook/web/atoms/Hub'
import type { HubCallFailed } from '@crook/web/rpc/HubConnection'
import { HubLink } from '@crook/web/rpc/HubLink'
import type { HubNotConnected } from '@crook/web/rpc/HubLink'

export type LaunchFailure =
  | CommandFailure
  | HubCallFailed
  | HubNotConnected
  | LaunchAnsweredWithoutPane

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

export const launchAtom = hubRuntime.fn((attempt: LaunchAttempt) =>
  Effect.gen(function* () {
    const link = yield* HubLink

    return yield* link
      .sendCommand(attempt.machine, attempt.key, attempt.command)
      .pipe(Effect.filterOrFail(isAgentStarted, () => new LaunchAnsweredWithoutPane()))
  }),
)
