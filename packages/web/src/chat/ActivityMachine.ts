import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import type { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { CompactBoundaryBlock, TurnDurationBlock } from '@crook/domain/TranscriptMessage'
import type {
  AssistantMessage,
  SystemMessage,
  UserBlock,
  UserMessage,
} from '@crook/domain/TranscriptMessage'
import type { AgentActivity } from '@crook/web/chat/ChatItems'
import { PresenceState } from '@crook/web/chat/PresenceMachine'
import type { TranscriptLine } from '@crook/web/chat/TranscriptState'
import { to } from '@crook/web/machine/Machine'
import type { Machine, Step } from '@crook/web/machine/Machine'

export interface TurnEvidence {
  readonly ends: boolean
  readonly at: Option.Option<DateTime.Utc>
}

export interface ActivityView {
  readonly status: Option.Option<AgentStatus>
  readonly workingSince: Option.Option<DateTime.Utc>
  readonly itemActivity: AgentActivity
}

const TOOL_USE_STOP = 'tool_use'
const MANUAL_COMPACT = 'manual'

const QuietStatus = Schema.Literals(['idle', 'done'])
const SeenActivity = Schema.Literals(['working', 'blocked', 'still'])

export const ActivityState = Schema.TaggedUnion({
  NoAgent: {},
  Still: { status: Schema.Union([QuietStatus, Schema.Literal('unknown')]) },
  Blocked: {},
  Working: { since: Schema.DateTimeUtc },
  Holding: { since: Schema.DateTimeUtc },
  Finished: { since: Schema.DateTimeUtc },
  Away: { was: SeenActivity },
})
export type ActivityState = typeof ActivityState.Type

export const ActivityEvent = Schema.TaggedUnion({
  AgentMissing: {},
  MachineAway: { was: SeenActivity },
  AgentAsks: {},
  StatusUnknown: {},
  AgentWorks: { since: Schema.DateTimeUtc },
  AnswerLanded: { since: Schema.DateTimeUtc },
  QuietTurnOpen: { status: QuietStatus },
  QuietTurnOver: { status: QuietStatus },
})
export type ActivityEvent = typeof ActivityEvent.Type

export const NO_AGENT = ActivityState.cases.NoAgent.make({})
export const BLOCKED = ActivityState.cases.Blocked.make({})
export const AGENT_MISSING = ActivityEvent.cases.AgentMissing.make({})
export const AGENT_ASKS = ActivityEvent.cases.AgentAsks.make({})
export const STATUS_UNKNOWN = ActivityEvent.cases.StatusUnknown.make({})

export const still = (status: 'idle' | 'done' | 'unknown') =>
  ActivityState.cases.Still.make({ status })
export const working = (since: DateTime.Utc) => ActivityState.cases.Working.make({ since })
export const holding = (since: DateTime.Utc) => ActivityState.cases.Holding.make({ since })
export const finished = (since: DateTime.Utc) => ActivityState.cases.Finished.make({ since })
export const away = (was: AgentActivity) => ActivityState.cases.Away.make({ was })
export const machineAway = (was: AgentActivity) => ActivityEvent.cases.MachineAway.make({ was })
export const agentWorks = (since: DateTime.Utc) => ActivityEvent.cases.AgentWorks.make({ since })
export const answerLanded = (since: DateTime.Utc) =>
  ActivityEvent.cases.AnswerLanded.make({ since })
export const quietTurnOpen = (status: 'idle' | 'done') =>
  ActivityEvent.cases.QuietTurnOpen.make({ status })
export const quietTurnOver = (status: 'idle' | 'done') =>
  ActivityEvent.cases.QuietTurnOver.make({ status })

export const sameActivity = Schema.toEquivalence(ActivityState)

const activityTransition = (state: ActivityState, event: ActivityEvent): Step<ActivityState> =>
  to(
    Match.value(event).pipe(
      Match.withReturnType<ActivityState>(),
      Match.tagsExhaustive({
        AgentMissing: () => NO_AGENT,
        MachineAway: ({ was }) => away(was),
        AgentAsks: () => BLOCKED,
        StatusUnknown: () => still('unknown'),
        AgentWorks: ({ since }) => working(since),
        AnswerLanded: ({ since }) => finished(since),
        QuietTurnOver: ({ status }) => still(status),
        QuietTurnOpen: ({ status }) =>
          Match.value(state).pipe(
            Match.withReturnType<ActivityState>(),
            Match.tags({
              Working: ({ since }) => holding(since),
              Holding: ({ since }) => holding(since),
              Finished: ({ since }) => holding(since),
            }),
            Match.orElse(() => still(status)),
          ),
      }),
    ),
  )

export const activityMachine: Machine<ActivityState, ActivityEvent> = {
  name: 'activity',
  states: ActivityState,
  events: ActivityEvent,
  initial: NO_AGENT,
  transition: activityTransition,
}

export const activityView = (state: ActivityState): ActivityView =>
  ActivityState.match<ActivityView>(state, {
    NoAgent: () => ({
      status: Option.none(),
      workingSince: Option.none(),
      itemActivity: 'still',
    }),
    Still: ({ status }) => ({
      status: Option.some(status),
      workingSince: Option.none(),
      itemActivity: 'still',
    }),
    Blocked: () => ({
      status: Option.some('blocked'),
      workingSince: Option.none(),
      itemActivity: 'blocked',
    }),
    Working: ({ since }) => ({
      status: Option.some('working'),
      workingSince: Option.some(since),
      itemActivity: 'working',
    }),
    Holding: ({ since }) => ({
      status: Option.some('working'),
      workingSince: Option.some(since),
      itemActivity: 'working',
    }),
    Finished: () => ({
      status: Option.some('done'),
      workingSince: Option.none(),
      itemActivity: 'still',
    }),
    Away: ({ was }) => ({
      status: Option.none(),
      workingSince: Option.none(),
      itemActivity: was,
    }),
  })

const endedSince = (since: DateTime.Utc, evidence: Option.Option<TurnEvidence>): boolean =>
  Option.exists(
    evidence,
    (found) => found.ends && Option.exists(found.at, (at) => DateTime.isGreaterThan(at, since)),
  )

const stillOpen = (evidence: Option.Option<TurnEvidence>): boolean =>
  Option.exists(evidence, (found) => !found.ends)

const workingEvent = (since: DateTime.Utc, evidence: Option.Option<TurnEvidence>): ActivityEvent =>
  endedSince(since, evidence) ? answerLanded(since) : agentWorks(since)

const statusEvent = (row: AgentRow, evidence: Option.Option<TurnEvidence>): ActivityEvent =>
  Match.value(row.status).pipe(
    Match.withReturnType<ActivityEvent>(),
    Match.when('working', () => workingEvent(row.statusChangedAt, evidence)),
    Match.when('blocked', () => AGENT_ASKS),
    Match.when('unknown', () => STATUS_UNKNOWN),
    Match.whenOr('idle', 'done', (status) =>
      stillOpen(evidence) ? quietTurnOpen(status) : quietTurnOver(status),
    ),
    Match.exhaustive,
  )

const seenActivity = (status: AgentStatus): AgentActivity =>
  Match.value(status).pipe(
    Match.withReturnType<AgentActivity>(),
    Match.when('working', () => 'working'),
    Match.when('blocked', () => 'blocked'),
    Match.orElse(() => 'still'),
  )

export const activityEventOf = (
  presence: PresenceState,
  row: Option.Option<AgentRow>,
  evidence: Option.Option<TurnEvidence>,
): ActivityEvent => {
  const statusOfRow = () =>
    Option.match(row, {
      onNone: (): ActivityEvent => AGENT_MISSING,
      onSome: (found) => statusEvent(found, evidence),
    })

  return PresenceState.match<ActivityEvent>(presence, {
    Loading: statusOfRow,
    Live: statusOfRow,
    Redialing: statusOfRow,
    Reconnecting: statusOfRow,
    Away: () =>
      Option.match(row, {
        onNone: (): ActivityEvent => AGENT_MISSING,
        onSome: (found) => machineAway(seenActivity(found.status)),
      }),
    Exited: () => AGENT_MISSING,
    Closed: () => AGENT_MISSING,
    NotClaude: () => AGENT_MISSING,
  })
}

export const runEventOf = (
  runningSince: Option.Option<DateTime.Utc>,
  evidence: Option.Option<TurnEvidence>,
): ActivityEvent =>
  Option.match(runningSince, {
    onNone: () => AGENT_MISSING,
    onSome: (since) => workingEvent(since, evidence),
  })

const userBlockEnds = (block: UserBlock): Option.Option<boolean> =>
  Match.value(block).pipe(
    Match.tagsExhaustive({
      Interruption: () => Option.some(true),
      Text: () => Option.some(false),
      Image: () => Option.some(false),
      ToolResult: () => Option.some(false),
      TaskNotification: () => Option.some(false),
      CompactSummary: () => Option.none<boolean>(),
      LocalCommand: () => Option.none<boolean>(),
      LocalCommandOutput: () => Option.none<boolean>(),
      Unrecognized: () => Option.none<boolean>(),
    }),
  )

const userEnds = (message: UserMessage): Option.Option<boolean> =>
  pipe(
    Option.liftPredicate(message, (found) => !found.isMeta),
    Option.map((found) => pipe(found.blocks, Arr.map(userBlockEnds), Arr.getSomes)),
    Option.filter((signs) => signs.length > 0),
    Option.map((signs) => Arr.contains(signs, true)),
  )

const assistantEnds = (message: AssistantMessage): boolean =>
  message.isApiError || Option.exists(message.stopReason, (reason) => reason !== TOOL_USE_STOP)

const closesTurn = (message: SystemMessage): boolean =>
  message.blocks.some(
    (block) =>
      Schema.is(TurnDurationBlock)(block) ||
      (Schema.is(CompactBoundaryBlock)(block) && Option.contains(block.trigger, MANUAL_COMPACT)),
  )

const signed = (
  ends: Option.Option<boolean>,
  at: Option.Option<DateTime.Utc>,
): Option.Option<TurnEvidence> => Option.map(ends, (found): TurnEvidence => ({ ends: found, at }))

const turnEvidenceOf = ({ message }: TranscriptLine): Option.Option<TurnEvidence> =>
  Match.value(message).pipe(
    Match.tagsExhaustive({
      User: (user) => signed(userEnds(user), user.timestamp),
      Assistant: (assistant) => signed(Option.some(assistantEnds(assistant)), assistant.timestamp),
      System: (system) =>
        signed(Option.as(Option.liftPredicate(system, closesTurn), true), system.timestamp),
      UnrecognizedEntry: () => Option.none<TurnEvidence>(),
      Malformed: () => Option.none<TurnEvidence>(),
      Omitted: () => Option.none<TurnEvidence>(),
    }),
  )

export const lastTurnEvidence = (lines: readonly TranscriptLine[]): Option.Option<TurnEvidence> =>
  Arr.findLast(lines, turnEvidenceOf)
