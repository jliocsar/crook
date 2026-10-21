import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Equivalence from 'effect/Equivalence'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'

import { type AgentRow, agentTitleOrPane } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { type MachineState, isHerdrLost, isResync } from '@crook/domain/MachineState'

import {
  HARK_ACTIVITY_DETAIL_LIMIT,
  HARK_ACTIVITY_LIFETIME,
  HARK_ACTIVITY_STATUS_LIMIT,
  HARK_RATE_WINDOW,
  HarkActivityContent,
} from '@crook/hub/HarkClient'
import { cutForHark, permissionOf } from '@crook/hub/NotificationPlan'

export type ActivityHerd = HashMap.HashMap<MachineId, HashMap.HashMap<PaneId, ActivityAgent>>

export type ActivityStep = Data.TaggedEnum<{
  Start: { readonly content: HarkActivityContent }
  Update: { readonly content: HarkActivityContent }
  End: { readonly content: HarkActivityContent; readonly linger: Duration.Duration }
  Wait: { readonly atMost: Option.Option<Duration.Duration> }
}>

export type ActivityAttempt = 'start' | 'update' | 'end'

export class ActivityAgent extends Data.Class<{
  readonly machineLabel: string
  readonly title: string
  readonly status: AgentStatus
  readonly since: DateTime.Utc
  readonly tool: Option.Option<string>
}> {}

export class LiveActivityRecord extends Schema.Class<LiveActivityRecord>('LiveActivityRecord')({
  lastStartAt: Schema.DateTimeUtcFromString,
  shown: Schema.OptionFromNullOr(Schema.fromJsonString(HarkActivityContent)),
}) {}

export const ActivityStep = Data.taggedEnum<ActivityStep>()

export const ACTIVITY_START_SPACING = Duration.minutes(1)
export const ALL_DONE_LINGER = Duration.seconds(45)
export const ACTIVITY_RESTART_MARGIN = HARK_RATE_WINDOW
export const WAIT_FOR_A_CHANGE = ActivityStep.Wait({ atMost: Option.none() })

export const ALL_DONE = new HarkActivityContent({
  status: 'All done',
  detail: Option.none(),
  symbol: 'success',
})

const waitAtMost = (duration: Duration.Duration) =>
  ActivityStep.Wait({ atMost: Option.some(duration) })

const bySince = Order.mapInput(DateTime.Order, (agent: ActivityAgent) => agent.since)

export const isSameContent: Equivalence.Equivalence<HarkActivityContent> = Equivalence.Struct({
  status: Equivalence.String,
  detail: Option.makeEquivalence(Equivalence.String),
  symbol: Equivalence.String,
})

const settledOf = (row: AgentRow) =>
  Option.match(row.beforeHandoff, {
    onNone: () => ({ status: row.status, since: row.statusChangedAt }),
    onSome: (before) => ({ status: before.status, since: before.statusChangedAt }),
  })

const activityAgentOf =
  (machineLabel: string, before: HashMap.HashMap<PaneId, ActivityAgent>) =>
  (row: AgentRow): Option.Option<ActivityAgent> => {
    const settled = settledOf(row)

    if (settled.status === 'unknown') {
      return HashMap.get(before, row.pane)
    }

    return Option.some(
      new ActivityAgent({
        machineLabel,
        title: agentTitleOrPane(row),
        status: settled.status,
        since: settled.since,
        tool: Option.map(permissionOf(row), (permission) => permission.tool),
      }),
    )
  }

export const activityAfterPublish = (
  herd: ActivityHerd,
  change: {
    readonly machineLabel: string
    readonly previous: Option.Option<MachineState>
    readonly next: MachineState
  },
): ActivityHerd => {
  if (
    isHerdrLost(change.next) ||
    Option.exists(change.previous, (previous) => isResync(previous, change.next))
  ) {
    return herd
  }

  const before = Option.getOrElse(HashMap.get(herd, change.next.machine), () =>
    HashMap.empty<PaneId, ActivityAgent>(),
  )
  const agentOf = activityAgentOf(change.machineLabel, before)

  return HashMap.set(
    herd,
    change.next.machine,
    pipe(
      change.next.agents,
      Arr.map((row) =>
        Option.map(agentOf(row), (agent): [PaneId, ActivityAgent] => [row.pane, agent]),
      ),
      Arr.getSomes,
      HashMap.fromIterable,
    ),
  )
}

export const activityAfterForgotten = (herd: ActivityHerd, machine: MachineId): ActivityHerd =>
  HashMap.remove(herd, machine)

const agentsWith = (herd: ActivityHerd, status: AgentStatus) =>
  pipe(
    HashMap.toValues(herd),
    Arr.flatMap((agents) => HashMap.toValues(agents)),
    Arr.filter((agent) => agent.status === status),
    Arr.sort(bySince),
  )

const needLine = (count: number) => `${count} ${count === 1 ? 'needs' : 'need'} you`

const workingLine = (count: number) => `${count} working`

const asking = (agent: ActivityAgent) =>
  Option.match(agent.tool, {
    onNone: () => 'has a question',
    onSome: (tool) => `wants ${tool}`,
  })

const cutContent = (status: string, detail: string, symbol: HarkActivityContent['symbol']) =>
  new HarkActivityContent({
    status: cutForHark(status, HARK_ACTIVITY_STATUS_LIMIT),
    detail: Option.some(cutForHark(detail, HARK_ACTIVITY_DETAIL_LIMIT)),
    symbol,
  })

export const isBusy = (herd: ActivityHerd): boolean =>
  Arr.isReadonlyArrayNonEmpty(agentsWith(herd, 'blocked')) ||
  Arr.isReadonlyArrayNonEmpty(agentsWith(herd, 'working'))

export const herdContent = (herd: ActivityHerd): HarkActivityContent => {
  const blocked = agentsWith(herd, 'blocked')
  const working = agentsWith(herd, 'working')
  const workingPart = Arr.isReadonlyArrayNonEmpty(working) ? [workingLine(working.length)] : []

  return pipe(
    Arr.head(blocked),
    Option.map((oldest) =>
      cutContent(
        [needLine(blocked.length), ...workingPart].join(' · '),
        `${oldest.title} ${asking(oldest)} · ${oldest.machineLabel}`,
        'warning',
      ),
    ),
    Option.orElse(() =>
      Option.map(Arr.last(working), (latest) =>
        cutContent(
          workingLine(working.length),
          `${latest.title} · ${latest.machineLabel}`,
          'terminal',
        ),
      ),
    ),
    Option.getOrElse(() => ALL_DONE),
  )
}

const untilThen = (now: DateTime.Utc, then: DateTime.Utc) =>
  Duration.millis(Math.max(0, DateTime.toEpochMillis(then) - DateTime.toEpochMillis(now)))

const isReached = (now: DateTime.Utc, then: DateTime.Utc) =>
  DateTime.toEpochMillis(now) >= DateTime.toEpochMillis(then)

const restartAtOf = (record: LiveActivityRecord) =>
  DateTime.addDuration(
    record.lastStartAt,
    Duration.subtract(HARK_ACTIVITY_LIFETIME, ACTIVITY_RESTART_MARGIN),
  )

const startWhenSpaced = (
  now: DateTime.Utc,
  record: Option.Option<LiveActivityRecord>,
  content: HarkActivityContent,
): ActivityStep =>
  pipe(
    record,
    Option.map((last) => DateTime.addDuration(last.lastStartAt, ACTIVITY_START_SPACING)),
    Option.filter((earliest) => !isReached(now, earliest)),
    Option.match({
      onNone: () => ActivityStep.Start({ content }),
      onSome: (earliest) => waitAtMost(untilThen(now, earliest)),
    }),
  )

const keepLive = (
  now: DateTime.Utc,
  record: LiveActivityRecord,
  shown: HarkActivityContent,
  content: HarkActivityContent,
): ActivityStep => {
  const restartAt = restartAtOf(record)

  if (isReached(now, restartAt)) {
    return ActivityStep.Start({ content })
  }

  return isSameContent(shown, content)
    ? waitAtMost(untilThen(now, restartAt))
    : ActivityStep.Update({ content })
}

const endWhenAllowed = (now: DateTime.Utc, endsFrom: DateTime.Utc): ActivityStep =>
  isReached(now, endsFrom)
    ? ActivityStep.End({ content: ALL_DONE, linger: ALL_DONE_LINGER })
    : waitAtMost(untilThen(now, endsFrom))

export const shownIn = (record: Option.Option<LiveActivityRecord>) =>
  Option.flatMap(record, (live) => live.shown)

export const nextActivityStep = (input: {
  readonly herd: ActivityHerd
  readonly enabled: boolean
  readonly record: Option.Option<LiveActivityRecord>
  readonly now: DateTime.Utc
  readonly endsFrom: DateTime.Utc
}): ActivityStep => {
  const shown = shownIn(input.record)

  if (!input.enabled) {
    return Option.match(shown, {
      onNone: () => WAIT_FOR_A_CHANGE,
      onSome: (content) => ActivityStep.End({ content, linger: Duration.zero }),
    })
  }

  if (!isBusy(input.herd)) {
    return Option.match(shown, {
      onNone: () => WAIT_FOR_A_CHANGE,
      onSome: () => endWhenAllowed(input.now, input.endsFrom),
    })
  }

  const content = herdContent(input.herd)

  return Option.match(Option.all({ record: input.record, shown }), {
    onNone: () => startWhenSpaced(input.now, input.record, content),
    onSome: (live) => keepLive(input.now, live.record, live.shown, content),
  })
}

export const attemptOf = (step: ActivityStep): Option.Option<ActivityAttempt> =>
  Match.value(step).pipe(
    Match.tagsExhaustive({
      Start: () => Option.some<ActivityAttempt>('start'),
      Update: () => Option.some<ActivityAttempt>('update'),
      End: () => Option.some<ActivityAttempt>('end'),
      Wait: () => Option.none(),
    }),
  )

export const recordAfter = (
  step: ActivityStep,
  record: Option.Option<LiveActivityRecord>,
  now: DateTime.Utc,
): Option.Option<LiveActivityRecord> =>
  Match.value(step).pipe(
    Match.tagsExhaustive({
      Start: (start) =>
        Option.some(
          new LiveActivityRecord({ lastStartAt: now, shown: Option.some(start.content) }),
        ),
      Update: (update) =>
        Option.map(
          record,
          (live) =>
            new LiveActivityRecord({
              lastStartAt: live.lastStartAt,
              shown: Option.some(update.content),
            }),
        ),
      End: () => recordWithoutActivity(record),
      Wait: () => record,
    }),
  )

export const recordWithoutActivity = (
  record: Option.Option<LiveActivityRecord>,
): Option.Option<LiveActivityRecord> =>
  Option.map(
    record,
    (live) => new LiveActivityRecord({ lastStartAt: live.lastStartAt, shown: Option.none() }),
  )
