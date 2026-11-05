import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { findMachine } from '@crook/domain/HerdView'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { panePresence } from '@crook/domain/MachineState'
import { RECONNECT_GRACE } from '@crook/protocol/AgentLink'
import type { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { to } from '@crook/web/machine/Machine'
import type { Machine, Step } from '@crook/web/machine/Machine'
import { SYNC_NOTICE_DELAY } from '@crook/web/rpc/HubLink'

export type PresenceCommand = Data.TaggedEnum<{
  WaitOutQuiet: { readonly drop: DateTime.Utc }
  WaitOutGrace: { readonly drop: DateTime.Utc }
}>

type PresenceStep = Step<PresenceState, PresenceCommand>

export const PresenceState = Schema.TaggedUnion({
  Loading: {},
  Live: {},
  Redialing: { drop: Schema.DateTimeUtc },
  Reconnecting: { drop: Schema.DateTimeUtc },
  Away: {},
  Exited: { at: Schema.DateTimeUtc },
  Closed: { at: Schema.DateTimeUtc },
  NotClaude: {},
})
export type PresenceState = typeof PresenceState.Type

export const PresenceEvent = Schema.TaggedUnion({
  PaneFound: {},
  PaneUnknown: {},
  PaneExited: { at: Schema.DateTimeUtc },
  PaneClosed: { at: Schema.DateTimeUtc },
  PaneNotClaude: {},
  MachineReconnecting: { drop: Schema.DateTimeUtc },
  MachineOffline: { drop: Schema.DateTimeUtc },
  QuietEnded: { drop: Schema.DateTimeUtc },
  GraceEnded: { drop: Schema.DateTimeUtc },
})
export type PresenceEvent = typeof PresenceEvent.Type

export const LOADING = PresenceState.cases.Loading.make({})
export const PANE_LIVE = PresenceState.cases.Live.make({})
export const AWAY = PresenceState.cases.Away.make({})
export const NOT_CLAUDE = PresenceState.cases.NotClaude.make({})
export const PANE_FOUND = PresenceEvent.cases.PaneFound.make({})
export const PANE_UNKNOWN = PresenceEvent.cases.PaneUnknown.make({})
export const PANE_NOT_CLAUDE = PresenceEvent.cases.PaneNotClaude.make({})

export const PresenceCommand = Data.taggedEnum<PresenceCommand>()

export const redialing = (drop: DateTime.Utc) => PresenceState.cases.Redialing.make({ drop })
export const reconnecting = (drop: DateTime.Utc) => PresenceState.cases.Reconnecting.make({ drop })
export const exited = (at: DateTime.Utc) => PresenceState.cases.Exited.make({ at })
export const closed = (at: DateTime.Utc) => PresenceState.cases.Closed.make({ at })
export const paneExited = (at: DateTime.Utc) => PresenceEvent.cases.PaneExited.make({ at })
export const paneClosed = (at: DateTime.Utc) => PresenceEvent.cases.PaneClosed.make({ at })
export const quietEnded = (drop: DateTime.Utc) => PresenceEvent.cases.QuietEnded.make({ drop })
export const graceEnded = (drop: DateTime.Utc) => PresenceEvent.cases.GraceEnded.make({ drop })
export const machineReconnecting = (drop: DateTime.Utc) =>
  PresenceEvent.cases.MachineReconnecting.make({ drop })
export const machineOffline = (drop: DateTime.Utc) =>
  PresenceEvent.cases.MachineOffline.make({ drop })

export const isPresent = PresenceState.isAnyOf(['Live', 'Redialing', 'Reconnecting'])
export const showsComposer = PresenceState.isAnyOf(['Loading', 'Live', 'Redialing', 'Reconnecting'])

const staysQuiet = (drop: DateTime.Utc): PresenceStep => [
  redialing(drop),
  [PresenceCommand.WaitOutQuiet({ drop })],
]

const givesItGrace = (drop: DateTime.Utc): PresenceStep => [
  reconnecting(drop),
  [PresenceCommand.WaitOutGrace({ drop })],
]

const presenceTransition = (state: PresenceState, event: PresenceEvent): PresenceStep =>
  Match.value(event).pipe(
    Match.withReturnType<PresenceStep>(),
    Match.tagsExhaustive({
      PaneFound: () => to(PANE_LIVE),
      PaneUnknown: () => to(LOADING),
      PaneExited: ({ at }) => to(PresenceState.guards.Exited(state) ? state : exited(at)),
      PaneClosed: ({ at }) => to(PresenceState.guards.Closed(state) ? state : closed(at)),
      PaneNotClaude: () => to(NOT_CLAUDE),
      MachineReconnecting: ({ drop }) =>
        Match.value(state).pipe(
          Match.withReturnType<PresenceStep>(),
          Match.tags({
            Live: () => staysQuiet(drop),
            Loading: () => staysQuiet(drop),
            Away: () => givesItGrace(drop),
          }),
          Match.orElse(() => to(state)),
        ),
      MachineOffline: ({ drop }) =>
        Match.value(state).pipe(
          Match.withReturnType<PresenceStep>(),
          Match.tags({
            Live: () => staysQuiet(drop),
            NotClaude: () => to(state),
          }),
          Match.orElse(() => to(AWAY)),
        ),
      QuietEnded: ({ drop }) =>
        Match.value(state).pipe(
          Match.withReturnType<PresenceStep>(),
          Match.tag('Redialing', (waiting) =>
            DateTime.Equivalence(waiting.drop, drop) ? givesItGrace(drop) : to(state),
          ),
          Match.orElse(() => to(state)),
        ),
      GraceEnded: ({ drop }) =>
        Match.value(state).pipe(
          Match.withReturnType<PresenceStep>(),
          Match.tag('Reconnecting', (waiting) =>
            to(DateTime.Equivalence(waiting.drop, drop) ? AWAY : state),
          ),
          Match.orElse(() => to(state)),
        ),
    }),
  )

export const presenceMachine: Machine<PresenceState, PresenceEvent, PresenceCommand> = {
  name: 'presence',
  states: PresenceState,
  events: PresenceEvent,
  initial: LOADING,
  transition: presenceTransition,
}

export const presenceTimer: (command: PresenceCommand) => Effect.Effect<PresenceEvent> =
  PresenceCommand.$match({
    WaitOutQuiet: ({ drop }) => Effect.as(Effect.sleep(SYNC_NOTICE_DELAY), quietEnded(drop)),
    WaitOutGrace: ({ drop }) => Effect.as(Effect.sleep(RECONNECT_GRACE), graceEnded(drop)),
  })

const endedEvent = (
  gone: boolean,
  seenBefore: boolean,
  verified: boolean,
  at: DateTime.Utc,
): PresenceEvent => {
  if (!seenBefore && !gone) {
    return PANE_NOT_CLAUDE
  }

  if (!seenBefore && !verified) {
    return PANE_UNKNOWN
  }

  return gone ? paneClosed(at) : paneExited(at)
}

export const presenceEventOf = (
  snapshot: Option.Option<HerdSnapshot>,
  machine: MachineId,
  pane: PaneId,
  seenBefore: boolean,
  verified: boolean,
): PresenceEvent =>
  Option.match(snapshot, {
    onNone: () => PANE_UNKNOWN,
    onSome: ({ view, syncedAt }) =>
      Option.match(findMachine(view, machine), {
        onNone: () => endedEvent(true, seenBefore, verified, syncedAt),
        onSome: (entry) =>
          Match.value(entry.machine.connection).pipe(
            Match.withReturnType<PresenceEvent>(),
            Match.when('reconnecting', () =>
              machineReconnecting(entry.machine.connectionChangedAt),
            ),
            Match.when('offline', () => machineOffline(entry.machine.connectionChangedAt)),
            Match.when('online', () =>
              Option.match(entry.state, {
                onNone: () => PANE_UNKNOWN,
                onSome: (state) => {
                  const found = panePresence(state, pane)

                  return found === 'agent'
                    ? PANE_FOUND
                    : endedEvent(found === 'gone', seenBefore, verified, syncedAt)
                },
              }),
            ),
            Match.exhaustive,
          ),
      }),
  })
