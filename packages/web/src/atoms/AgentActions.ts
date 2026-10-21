import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Equal from 'effect/Equal'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import type * as AsyncResult from 'effect/reactivity/AsyncResult'
import * as Struct from 'effect/Struct'

import { ClosePane, RenameAgent, samePaneLabel } from '@crook/domain/Command'
import type { CommandReceipt } from '@crook/domain/Command'
import type { HerdMachine } from '@crook/domain/HerdView'
import type { IdempotencyKey, MachineId, PaneId } from '@crook/domain/Ids'
import { agentsIn } from '@crook/domain/MachineState'
import {
  isCommandUnderway,
  isRetriableFailure,
  pinProgress,
  sheetOutcome,
} from '@crook/web/actions/PaneActions'
import type { SheetOutcome } from '@crook/web/actions/PaneActions'
import type { SendCommandFailure } from '@crook/web/atoms/ActionFailure'
import { ActionProgress, commandProgress } from '@crook/web/atoms/ActionProgress'
import type { CommandProgress } from '@crook/web/atoms/ActionProgress'
import { CommandRequest, sendCommandAtom } from '@crook/web/atoms/Commands'
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

export type ActionsIntent = Data.TaggedEnum<{
  Open: { readonly agent: PaneAddress; readonly origin: ActionsOrigin }
  Dismiss: Record<never, never>
  Finish: { readonly agent: PaneAddress }
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
  readonly rename: CommandProgress
  readonly close: CommandProgress
  readonly pin: ActionProgress<boolean>
  readonly outcome: SheetOutcome
}

type CommandResultOf = (
  key: IdempotencyKey,
) => AsyncResult.AsyncResult<CommandReceipt, SendCommandFailure>

type SessionsContext = Atom.WriteContext<readonly ActionsSession[]>

export const ActionsIntent = Data.taggedEnum<ActionsIntent>()

export const setPinnedAtom = Atom.family((agent: PaneAddress) =>
  hubRuntime
    .fn((pinned: boolean) =>
      Effect.gen(function* () {
        const link = yield* HubLink

        yield* link.setPinned(agent.machine, agent.pane, pinned)

        return pinned
      }),
    )
    .pipe(Atom.keepAlive),
)

const sessionsAtom = Atom.make<readonly ActionsSession[]>([]).pipe(Atom.keepAlive)

const commandResultsIn =
  (context: SessionsContext): CommandResultOf =>
  (key) =>
    context.get(sendCommandAtom(key))

const isCloseUnderway =
  (resultOf: CommandResultOf) =>
  (session: ActionsSession): boolean =>
    Option.exists(session.close, (attempt) => isCommandUnderway(resultOf(attempt.key)))

const shownSession = (
  sessions: readonly ActionsSession[],
  resultOf: CommandResultOf,
): Option.Option<ActionsSession> =>
  pipe(
    Arr.findFirst(sessions, (session) => session.visible),
    Option.orElse(() => Arr.findFirst(sessions, (session) => !isCloseUnderway(resultOf)(session))),
  )

const isSessionOf = (agent: PaneAddress) => (session: ActionsSession) =>
  Equal.equals(session.agent, agent)

const replaced = (
  sessions: readonly ActionsSession[],
  agent: PaneAddress,
  next: Option.Option<ActionsSession>,
): readonly ActionsSession[] =>
  Arr.flatMap(sessions, (session) =>
    isSessionOf(agent)(session) ? Option.toArray(next) : [session],
  )

const hidden = (session: ActionsSession) =>
  new ActionsSession(Struct.evolve(session, { visible: () => false }))

const keyFor = <Attempt extends { readonly key: IdempotencyKey }>(
  resultOf: CommandResultOf,
  previous: Option.Option<Attempt>,
  sameRequest: (attempt: Attempt) => boolean,
): IdempotencyKey =>
  pipe(
    previous,
    Option.filter(sameRequest),
    Option.filter((attempt) => isRetriableFailure(resultOf(attempt.key))),
    Option.match({
      onNone: mintIdempotencyKey,
      onSome: (attempt) => attempt.key,
    }),
  )

const sameLabel = (label: Option.Option<string>) => (attempt: RenameAttempt) =>
  samePaneLabel(attempt.label, label)

const sameConfirmation = (confirmed: boolean) => (attempt: CloseAttempt) =>
  attempt.confirmed === confirmed

const withShownSession = (
  context: SessionsContext,
  step: (session: ActionsSession, sessions: readonly ActionsSession[]) => void,
): void => {
  const sessions = context.get(sessionsAtom)

  Option.match(shownSession(sessions, commandResultsIn(context)), {
    onNone: () => undefined,
    onSome: (session) => {
      step(session, sessions)
    },
  })
}

const opened = (
  context: SessionsContext,
  agent: PaneAddress,
  origin: ActionsOrigin,
): readonly ActionsSession[] => {
  const closing = Arr.filter(context.get(sessionsAtom), isCloseUnderway(commandResultsIn(context)))
  const reopened = Option.match(Arr.findFirst(closing, isSessionOf(agent)), {
    onNone: () =>
      new ActionsSession({
        agent,
        origin,
        visible: true,
        rename: Option.none(),
        close: Option.none(),
        pin: Option.none(),
      }),
    onSome: (session) =>
      new ActionsSession(Struct.evolve(session, { origin: () => origin, visible: () => true })),
  })

  return pipe(
    closing,
    Arr.filter((session) => !isSessionOf(agent)(session)),
    Arr.map(hidden),
    Arr.append(reopened),
  )
}

export const agentActionsAtom = Atom.writable(
  (get) => get(sessionsAtom),
  (context, intent: ActionsIntent) => {
    ActionsIntent.$match(intent, {
      Open: ({ agent, origin }) => {
        context.set(sessionsAtom, opened(context, agent, origin))
      },
      Dismiss: () => {
        withShownSession(context, (session, sessions) => {
          context.set(
            sessionsAtom,
            replaced(
              sessions,
              session.agent,
              Option.liftPredicate(session, isCloseUnderway(commandResultsIn(context))).pipe(
                Option.map(hidden),
              ),
            ),
          )
        })
      },
      Finish: ({ agent }) => {
        context.set(sessionsAtom, replaced(context.get(sessionsAtom), agent, Option.none()))
      },
      Rename: ({ label }) => {
        withShownSession(context, (session, sessions) => {
          const key = keyFor(commandResultsIn(context), session.rename, sameLabel(label))

          context.set(
            sessionsAtom,
            replaced(
              sessions,
              session.agent,
              Option.some(
                new ActionsSession(
                  Struct.evolve(session, {
                    visible: () => true,
                    rename: () => Option.some(new RenameAttempt({ key, label })),
                  }),
                ),
              ),
            ),
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
        withShownSession(context, (session, sessions) => {
          const key = keyFor(commandResultsIn(context), session.close, sameConfirmation(confirmed))

          context.set(
            sessionsAtom,
            replaced(
              sessions,
              session.agent,
              Option.some(
                new ActionsSession(
                  Struct.evolve(session, {
                    visible: () => true,
                    close: () => Option.some(new CloseAttempt({ key, confirmed })),
                  }),
                ),
              ),
            ),
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
        withShownSession(context, (session, sessions) => {
          context.set(
            sessionsAtom,
            replaced(
              sessions,
              session.agent,
              Option.some(
                new ActionsSession(
                  Struct.evolve(session, { visible: () => true, pin: () => Option.some(pinned) }),
                ),
              ),
            ),
          )
          context.set(setPinnedAtom(session.agent), pinned)
        })
      },
    })
  },
)

const viewOf = (
  get: Atom.AtomContext,
  session: ActionsSession,
  open: boolean,
): AgentActionsView => {
  const herdMachine = pipe(
    get(herdAtom),
    Option.flatMap((snapshot) =>
      Arr.findFirst(snapshot.view.machines, (entry) => entry.machine.id === session.agent.machine),
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
  const rename = commandOf(session.rename)
  const close = commandOf(session.close)
  const pin = Option.match(session.pin, {
    onNone: () => ActionProgress.Idle(),
    onSome: () =>
      pinProgress(
        get(setPinnedAtom(session.agent)),
        Option.exists(card, (found) => found.pinned),
      ),
  })

  return {
    session,
    herdMachine,
    card,
    open,
    machineOnline: Option.exists(herdMachine, (entry) => entry.machine.connection === 'online'),
    rename,
    close,
    pin,
    outcome: sheetOutcome({ herdMachine, pane: session.agent.pane, rename, close, pin }),
  }
}

export const agentActionsViewsAtom = Atom.make((get): readonly AgentActionsView[] => {
  const sessions = get(sessionsAtom)
  const shown = shownSession(sessions, (key) => get(sendCommandAtom(key)))

  return Arr.map(sessions, (session) =>
    viewOf(get, session, Option.exists(shown, isSessionOf(session.agent))),
  )
})

export const agentActionsViewAtom = Atom.make((get): Option.Option<AgentActionsView> =>
  Arr.findFirst(get(agentActionsViewsAtom), (view) => view.open),
)
