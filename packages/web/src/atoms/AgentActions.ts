import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import * as Struct from 'effect/Struct'

import { ClosePane, RenameAgent, samePaneLabel } from '@crook/domain/Command'
import type { Command } from '@crook/domain/Command'
import type { HerdMachine } from '@crook/domain/HerdView'
import type { IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'
import { agentsIn } from '@crook/domain/MachineState'
import {
  ActionProgress,
  commandProgress,
  isCommandUnderway,
  isRetriableFailure,
  isUnderway,
  pinProgress,
} from '@crook/web/actions/PaneActions'
import { herdAtom } from '@crook/web/atoms/Herd'
import { hubRuntime } from '@crook/web/atoms/Hub'
import { cardFor } from '@crook/web/herd/HerdLayout'
import type { AgentCardModel } from '@crook/web/herd/HerdLayout'
import { HubLink } from '@crook/web/rpc/HubLink'
import { mintIdempotencyKey } from '@crook/web/rpc/IdempotencyKeys'

export type ActionsOrigin = 'card' | 'chat'

export class PaneAddress extends Data.Class<{
  readonly machine: MachineId
  readonly pane: PaneId
}> {}

export class RenameAttempt extends Data.Class<{
  readonly key: IdempotencyKey
  readonly label: Option.Option<string>
}> {}

export class CloseAttempt extends Data.Class<{
  readonly key: IdempotencyKey
  readonly confirmed: boolean
}> {}

export class ActionsSession extends Data.Class<{
  readonly agent: PaneAddress
  readonly origin: ActionsOrigin
  readonly visible: boolean
  readonly rename: Option.Option<RenameAttempt>
  readonly close: Option.Option<CloseAttempt>
  readonly pin: Option.Option<boolean>
}> {}

export class CommandRequest extends Data.Class<{
  readonly machine: MachineId
  readonly command: Command
}> {}

export type ActionsIntent = Data.TaggedEnum<{
  Open: { readonly agent: PaneAddress; readonly origin: ActionsOrigin }
  Dismiss: Record<never, never>
  Finish: Record<never, never>
  Rename: { readonly label: Option.Option<string> }
  Close: { readonly confirmed: boolean }
  Pin: { readonly pinned: boolean }
}>

export interface AgentActionsView {
  readonly session: ActionsSession
  readonly herdMachine: Option.Option<HerdMachine>
  readonly card: Option.Option<AgentCardModel>
  readonly open: boolean
  readonly machineOnline: boolean
  readonly rename: ActionProgress
  readonly close: ActionProgress
  readonly pin: ActionProgress
}

export const ActionsIntent = Data.taggedEnum<ActionsIntent>()

export const sendCommandAtom = Atom.family((key: IdempotencyKey) =>
  hubRuntime
    .fn((request: CommandRequest) =>
      Effect.gen(function* () {
        const link = yield* HubLink

        return yield* link.sendCommand(request.machine, key, request.command)
      }),
    )
    .pipe(Atom.keepAlive),
)

export const setPinnedAtom = Atom.family((agent: PaneAddress) =>
  hubRuntime.fn((pinned: boolean) =>
    Effect.gen(function* () {
      const link = yield* HubLink

      yield* link.setPinned(agent.machine, agent.pane, pinned)

      return pinned
    }),
  ),
)

const sessionAtom = Atom.make(Option.none<ActionsSession>()).pipe(Atom.keepAlive)

const keyFor = <Attempt extends { readonly key: IdempotencyKey }>(
  context: Atom.WriteContext<Option.Option<ActionsSession>>,
  previous: Option.Option<Attempt>,
  sameRequest: (attempt: Attempt) => boolean,
): IdempotencyKey =>
  pipe(
    previous,
    Option.filter(sameRequest),
    Option.filter((attempt) => isRetriableFailure(context.get(sendCommandAtom(attempt.key)))),
    Option.match({
      onNone: mintIdempotencyKey,
      onSome: (attempt) => attempt.key,
    }),
  )

const sameLabel = (label: Option.Option<string>) => (attempt: RenameAttempt) =>
  samePaneLabel(attempt.label, label)

const sameConfirmation = (confirmed: boolean) => (attempt: CloseAttempt) =>
  attempt.confirmed === confirmed

const withSession = (
  context: Atom.WriteContext<Option.Option<ActionsSession>>,
  step: (session: ActionsSession) => void,
): void => {
  Option.match(context.get(sessionAtom), { onNone: () => undefined, onSome: step })
}

const closeUnderway = (
  context: Atom.WriteContext<Option.Option<ActionsSession>>,
  session: ActionsSession,
): boolean =>
  Option.exists(session.close, (attempt) =>
    isCommandUnderway(context.get(sendCommandAtom(attempt.key))),
  )

const evolved = (
  session: ActionsSession,
  change: Partial<{
    readonly visible: (visible: boolean) => boolean
    readonly rename: (attempt: Option.Option<RenameAttempt>) => Option.Option<RenameAttempt>
    readonly close: (attempt: Option.Option<CloseAttempt>) => Option.Option<CloseAttempt>
    readonly pin: (pinned: Option.Option<boolean>) => Option.Option<boolean>
  }>,
) => Option.some(new ActionsSession(Struct.evolve(session, change)))

export const agentActionsAtom = Atom.writable(
  (get) => get(sessionAtom),
  (context, intent: ActionsIntent) => {
    ActionsIntent.$match(intent, {
      Open: ({ agent, origin }) => {
        context.set(
          sessionAtom,
          Option.some(
            new ActionsSession({
              agent,
              origin,
              visible: true,
              rename: Option.none(),
              close: Option.none(),
              pin: Option.none(),
            }),
          ),
        )
      },
      Dismiss: () => {
        withSession(context, (session) => {
          context.set(
            sessionAtom,
            closeUnderway(context, session)
              ? evolved(session, { visible: () => false })
              : Option.none(),
          )
        })
      },
      Finish: () => {
        context.set(sessionAtom, Option.none())
      },
      Rename: ({ label }) => {
        withSession(context, (session) => {
          const key = keyFor(context, session.rename, sameLabel(label))

          context.set(
            sessionAtom,
            evolved(session, {
              visible: () => true,
              rename: () => Option.some(new RenameAttempt({ key, label })),
            }),
          )
          context.set(
            sendCommandAtom(key),
            new CommandRequest({
              machine: session.agent.machine,
              command: new RenameAgent({ pane: session.agent.pane, label }),
            }),
          )
        })
      },
      Close: ({ confirmed }) => {
        withSession(context, (session) => {
          const key = keyFor(context, session.close, sameConfirmation(confirmed))

          context.set(
            sessionAtom,
            evolved(session, {
              visible: () => true,
              close: () => Option.some(new CloseAttempt({ key, confirmed })),
            }),
          )
          context.set(
            sendCommandAtom(key),
            new CommandRequest({
              machine: session.agent.machine,
              command: new ClosePane({ pane: session.agent.pane, confirmed }),
            }),
          )
        })
      },
      Pin: ({ pinned }) => {
        withSession(context, (session) => {
          context.set(
            sessionAtom,
            evolved(session, { visible: () => true, pin: () => Option.some(pinned) }),
          )
          context.set(setPinnedAtom(session.agent), pinned)
        })
      },
    })
  },
)

export const agentActionsViewAtom = Atom.make((get): Option.Option<AgentActionsView> =>
  Option.map(get(sessionAtom), (session) => {
    const herdMachine = pipe(
      get(herdAtom),
      Option.flatMap((snapshot) =>
        Arr.findFirst(
          snapshot.view.machines,
          (entry) => entry.machine.id === session.agent.machine,
        ),
      ),
    )
    const agents = agentsIn(Option.flatMap(herdMachine, (entry) => entry.state))
    const card = Option.flatMap(herdMachine, (entry) =>
      pipe(
        Arr.findFirst(agents, (row) => row.pane === session.agent.pane),
        Option.map(cardFor(entry)),
      ),
    )
    const commandOf = (attempt: Option.Option<{ readonly key: IdempotencyKey }>) =>
      Option.match(attempt, {
        onNone: () => ActionProgress.Idle(),
        onSome: ({ key }) => commandProgress(get(sendCommandAtom(key)), agents),
      })
    const close = commandOf(session.close)

    return {
      session,
      herdMachine,
      card,
      open: session.visible || !isUnderway(close),
      machineOnline: Option.exists(herdMachine, (entry) => entry.machine.connection === 'online'),
      rename: commandOf(session.rename),
      close,
      pin: Option.match(session.pin, {
        onNone: () => ActionProgress.Idle(),
        onSome: () =>
          pinProgress(
            get(setPinnedAtom(session.agent)),
            Option.exists(card, (found) => found.pinned),
          ),
      }),
    }
  }),
)
