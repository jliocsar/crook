import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import { edgeKindOf, isWatching, LOADING_CHAT, withPresence } from '@crook/web/chat/ChatModel'
import {
  graceEnded,
  isPresent,
  machineOffline,
  machineReconnecting,
  PANE_FOUND,
  PANE_NOT_CLAUDE,
  PANE_UNKNOWN,
  paneClosed,
  paneExited,
  PresenceCommand,
  PresenceEvent,
  presenceMachine,
  PresenceState,
  quietEnded,
} from '@crook/web/chat/PresenceMachine'
import { caseName } from '@crook/web/machine/Machine'
import type { WalkSpec } from '@crook/web/machine/Walk'

const A_DROP = DateTime.makeUnsafe(1000)
const ANOTHER_DROP = DateTime.makeUnsafe(2000)

const isWaitEnding = PresenceEvent.isAnyOf(['QuietEnded', 'GraceEnded'])
const isWaiting = PresenceState.isAnyOf(['Redialing', 'Reconnecting'])

const showsCard = (state: PresenceState): boolean =>
  Option.isSome(edgeKindOf(withPresence(LOADING_CHAT, state)))

const showsComposer = (state: PresenceState): boolean =>
  isWatching(withPresence(LOADING_CHAT, state))

export const presenceWalk: WalkSpec<PresenceState, PresenceEvent, PresenceCommand> = {
  machine: presenceMachine,
  events: () => [
    PANE_FOUND,
    PANE_UNKNOWN,
    paneExited(A_DROP),
    paneClosed(A_DROP),
    PANE_NOT_CLAUDE,
    machineReconnecting(A_DROP),
    machineOffline(A_DROP),
    quietEnded(A_DROP),
    graceEnded(A_DROP),
    quietEnded(ANOTHER_DROP),
    graceEnded(ANOTHER_DROP),
  ],
  home: PresenceState.guards.Live,
  identity: (state) => caseName(PresenceState, state),
  commandName: PresenceCommand.$match({
    WaitOutQuiet: () => 'WaitOutQuiet',
    WaitOutGrace: () => 'WaitOutGrace',
  }),
  invariants: [
    {
      name: 'the dock holds the composer or a card, and only a pane that never ran Claude neither',
      holds: (state) =>
        PresenceState.guards.NotClaude(state) || showsComposer(state) !== showsCard(state),
    },
    {
      name: 'a machine on its way back keeps the composer and shows no card',
      holds: (state) => !isPresent(state) || (showsComposer(state) && !showsCard(state)),
    },
    {
      name: 'a pane that never ran Claude shows neither',
      holds: (state) =>
        !PresenceState.guards.NotClaude(state) || (!showsComposer(state) && !showsCard(state)),
    },
  ],
  arrowRules: [
    {
      name: 'a finished wait for another drop changes nothing',
      holds: ({ from, event, to }) =>
        !isWaitEnding(event) || event.drop !== ANOTHER_DROP || from === to,
    },
    {
      name: 'a redial reaches the card only by its grace ending or the hub giving up',
      holds: ({ from, event, to }) =>
        !isWaiting(from) ||
        !PresenceState.guards.Away(to) ||
        PresenceEvent.isAnyOf(['GraceEnded', 'MachineOffline'])(event),
    },
    {
      name: 'a live pane never reaches the card in one step',
      holds: ({ from, to }) => !PresenceState.guards.Live(from) || !PresenceState.guards.Away(to),
    },
    {
      name: 'a pane that never ran Claude never reaches the card by its machine leaving',
      holds: ({ from, event, to }) =>
        !PresenceState.guards.NotClaude(from) ||
        !PresenceEvent.isAnyOf(['MachineReconnecting', 'MachineOffline'])(event) ||
        !showsCard(to),
    },
    {
      name: 'a step starts one command at most, since the next call of an atom function ends the last',
      holds: ({ commands }) => commands.length <= 1,
    },
    {
      name: 'entering a wait starts what ends it',
      holds: ({ from, to, commands }) =>
        !isWaiting(to) ||
        caseName(PresenceState, from) === caseName(PresenceState, to) ||
        commands.length === 1,
    },
  ],
}
