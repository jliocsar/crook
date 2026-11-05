import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import {
  ActivityEvent,
  activityMachine,
  ActivityState,
  activityView,
  AGENT_ASKS,
  AGENT_MISSING,
  agentWorks,
  answerLanded,
  machineAway,
  quietTurnOpen,
  quietTurnOver,
  sameActivity,
  STATUS_UNKNOWN,
} from '@crook/web/chat/ActivityMachine'
import { caseName } from '@crook/web/machine/Machine'
import type { WalkSpec } from '@crook/web/machine/Walk'

const A_FLIP = DateTime.makeUnsafe(1000)

const isTurnUnderway = ActivityState.guards.Working

const says = (state: ActivityState, status: string): boolean =>
  Option.contains(activityView(state).status, status)

const carried = (state: ActivityState): string =>
  ActivityState.match(state, {
    NoAgent: () => '',
    Still: ({ status }) => status,
    Blocked: () => '',
    Working: () => '',
    Finished: () => '',
    Away: ({ was }) => was,
  })

export const activityWalk: WalkSpec<ActivityState, ActivityEvent, never> = {
  machine: activityMachine,
  events: () => [
    AGENT_MISSING,
    machineAway('working'),
    machineAway('blocked'),
    machineAway('still'),
    AGENT_ASKS,
    STATUS_UNKNOWN,
    agentWorks(A_FLIP),
    answerLanded(A_FLIP),
    quietTurnOpen('idle'),
    quietTurnOpen('done'),
    quietTurnOver('idle'),
    quietTurnOver('done'),
  ],
  home: (state) => ActivityState.guards.Still(state) && state.status === 'idle',
  identity: (state) => `${caseName(ActivityState, state)} ${carried(state)}`,
  invariants: [
    {
      name: 'the Working row, Stop and Queued go together, and only a turn underway has them',
      holds: (state) => Option.isSome(activityView(state).workingSince) === isTurnUnderway(state),
    },
    {
      name: 'the header says working exactly when the Working row shows',
      holds: (state) => says(state, 'working') === isTurnUnderway(state),
    },
    {
      name: 'the rows read a turn underway as working',
      holds: (state) => !isTurnUnderway(state) || activityView(state).itemActivity === 'working',
    },
    {
      name: 'a turn that ended reads as still to its rows',
      holds: (state) =>
        !ActivityState.guards.Finished(state) || activityView(state).itemActivity === 'still',
    },
    {
      name: 'a question is the only thing the header says needs you',
      holds: (state) => says(state, 'blocked') === ActivityState.guards.Blocked(state),
    },
    {
      name: 'a machine that left says nothing itself, the presence machine does',
      holds: (state) =>
        !ActivityState.guards.Away(state) || Option.isNone(activityView(state).status),
    },
  ],
  arrowRules: [
    {
      name: 'only a turn seen working holds after herdr goes quiet, and it keeps its start',
      holds: ({ from, event, to }) =>
        !ActivityEvent.guards.QuietTurnOpen(event) || !isTurnUnderway(to) || sameActivity(from, to),
    },
    {
      name: 'a turn that is over never holds',
      holds: ({ event, to }) => !ActivityEvent.guards.QuietTurnOver(event) || !isTurnUnderway(to),
    },
    {
      name: 'the answer takes the Working row with it',
      holds: ({ event, to }) =>
        !ActivityEvent.guards.AnswerLanded(event) || ActivityState.guards.Finished(to),
    },
    {
      name: 'a question takes the Working row with it',
      holds: ({ event, to }) => !ActivityEvent.guards.AgentAsks(event) || !isTurnUnderway(to),
    },
    {
      name: 'a machine leaving takes the Working row with it',
      holds: ({ event, to }) => !ActivityEvent.guards.MachineAway(event) || !isTurnUnderway(to),
    },
  ],
}
