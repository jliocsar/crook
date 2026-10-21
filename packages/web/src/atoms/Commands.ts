import * as Arr from 'effect/Array'
import * as Cause from 'effect/Cause'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Equivalence from 'effect/Equivalence'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Random from 'effect/Random'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Atom from 'effect/reactivity/Atom'

import { hasMovedSince, hasStarted } from '@crook/domain/Command'
import type { Command, CommandReceipt } from '@crook/domain/Command'
import type { HerdView } from '@crook/domain/HerdView'
import { IdempotencyKey } from '@crook/domain/Ids'
import type { MachineId } from '@crook/domain/Ids'
import { agentsIn } from '@crook/domain/MachineState'
import { herdAtom } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { HubLink } from '@crook/web/rpc/HubLink'

export type PendingAction = Data.TaggedEnum<{
  Idle: Record<never, never>
  Sending: Record<never, never>
  Sent: { readonly receipt: CommandReceipt }
  Done: { readonly receipt: CommandReceipt }
  Failed: { readonly message: string }
}>

export const PendingAction = Data.taggedEnum<PendingAction>()

export const COMMAND_DIED =
  'The hub gave no answer crook can read, so it is not known whether this reached the agent. Check the chat before sending it again.'

export class CommandRequest extends Data.Class<{
  readonly machine: MachineId
  readonly command: Command
}> {}

export class PendingActionKey extends Data.Class<{
  readonly key: IdempotencyKey
  readonly machine: MachineId
}> {}

export const mintIdempotencyKey = Effect.map(
  Effect.all([
    Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER),
    Random.nextIntBetween(0, Number.MAX_SAFE_INTEGER),
  ]),
  ([high, low]) => IdempotencyKey.make(`${high.toString(36)}-${low.toString(36)}`),
)

export const sendCommandAtom = Atom.family((key: IdempotencyKey) =>
  hubRuntime.fn((request: CommandRequest) =>
    Effect.gen(function* () {
      const link = yield* HubLink

      return yield* link.sendCommand(request.machine, key, request.command)
    }),
  ),
)

const agentsOf = (herd: HerdView, machine: MachineId) =>
  pipe(
    Arr.findFirst(herd.machines, (entry) => entry.machine.id === machine),
    Option.flatMap((entry) => entry.state),
    agentsIn,
  )

export const isConfirmed = (
  receipt: CommandReceipt,
  herd: HerdView,
  machine: MachineId,
): boolean => {
  const agents = agentsOf(herd, machine)

  return Match.value(receipt).pipe(
    Match.tagsExhaustive({
      InputDelivered: (delivered) =>
        Option.match(
          Arr.findFirst(agents, (row) => row.pane === delivered.pane),
          { onNone: () => true, onSome: (row) => hasMovedSince(delivered, row) },
        ),
      PaneRenamed: (renamed) =>
        agents.some(
          (row) =>
            row.pane === renamed.pane &&
            Option.makeEquivalence(Equivalence.String)(row.label, renamed.label),
        ),
      PaneClosed: (closed) => !agents.some((row) => row.pane === closed.pane),
      AgentStarted: (started) => hasStarted(started, agents),
    }),
  )
}

export const pendingAction = (
  result: AsyncResult.AsyncResult<CommandReceipt, { readonly message: string }>,
  herd: Option.Option<HerdView>,
  machine: MachineId,
): PendingAction => {
  if (AsyncResult.isWaiting(result)) {
    return PendingAction.Sending()
  }

  return AsyncResult.match(result, {
    onInitial: () => PendingAction.Idle(),
    onSuccess: ({ value }) =>
      Option.exists(herd, (view) => isConfirmed(value, view, machine))
        ? PendingAction.Done({ receipt: value })
        : PendingAction.Sent({ receipt: value }),
    onFailure: ({ cause }) =>
      PendingAction.Failed({
        message: pipe(
          Cause.findErrorOption(cause),
          Option.map((error) => error.message),
          Option.getOrElse(() => COMMAND_DIED),
        ),
      }),
  })
}

export const pendingActionAtom = Atom.family((key: PendingActionKey) =>
  Atom.make((get) =>
    pendingAction(
      get(sendCommandAtom(key.key)),
      Option.map(get(herdAtom), (snapshot) => snapshot.view),
      key.machine,
    ),
  ),
)
