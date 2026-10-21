import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import { pipe } from 'effect/Function'
import * as Hash from 'effect/Hash'
import * as HashMap from 'effect/HashMap'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'

import { type AgentRow, agentTitleOrPane, settledStatusOf } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import type { MachineId, PaneId } from '@crook/domain/Ids'
import { type MachineState, isHerdrLost, isResync } from '@crook/domain/MachineState'
import { needsYouLabel } from '@crook/domain/NeedsYouLabel'

import {
  HARK_ACTIVITY_DETAIL_LIMIT,
  HARK_ACTIVITY_LIFETIME,
  HARK_ACTIVITY_STATUS_LIMIT,
  HARK_RATE_WINDOW,
  HarkActivityContent,
} from '@crook/hub/HarkClient'
import { RECONNECT_GRACE } from '@crook/hub/Herd'
import { cutForHark, permissionOf } from '@crook/hub/NotificationPlan'

export type MachineAgents = HashMap.HashMap<PaneId, ActivityAgent>

export type ActivityHerd = HashMap.HashMap<MachineId, MachineAgents>

export type ActivityStep = Data.TaggedEnum<{
  Start: { readonly content: HarkActivityContent }
  Update: { readonly content: HarkActivityContent }
  End: { readonly content: HarkActivityContent; readonly linger: Duration.Duration }
  Wait: { readonly atMost: Option.Option<Duration.Duration> }
}>

export type ActivityAttempt = 'start' | 'update' | 'end'

type FollowedFields = Pick<FollowedHerd, 'agents' | 'awayFrom' | 'endsFrom'>

export class ActivityAgent extends Data.Class<{
  readonly machineLabel: string
  readonly title: string
  readonly status: AgentStatus
  readonly since: DateTime.Utc
  readonly tool: Option.Option<string>
}> {}

export class FollowedHerd extends Data.Class<{
  readonly agents: ActivityHerd
  readonly awayFrom: HashMap.HashMap<MachineId, DateTime.Utc>
  readonly busyThroughResync: boolean
  readonly endsFrom: DateTime.Utc
}> {}

export class LiveActivityRecord extends Schema.Class<LiveActivityRecord>('LiveActivityRecord')({
  lastStartAt: Schema.DateTimeUtcFromString,
  shown: Schema.OptionFromNullOr(Schema.fromJsonString(HarkActivityContent)),
}) {}

export const ActivityStep = Data.taggedEnum<ActivityStep>()

export const ACTIVITY_START_SPACING = Duration.minutes(1)
export const ALL_DONE_LINGER = Duration.seconds(45)
export const ACTIVITY_RESTART_LEAD_OF_ONE_RATE_WINDOW = HARK_RATE_WINDOW
export const ACTIVITY_START_KEY_PREFIX = 'crook/herd'
export const WAIT_FOR_A_CHANGE = ActivityStep.Wait({ atMost: Option.none() })

export const ALL_DONE = new HarkActivityContent({
  status: 'All done',
  detail: Option.none(),
  symbol: 'success',
})

export const isSameContent = Schema.toEquivalence(HarkActivityContent)

const encodeContent = Schema.encodeSync(Schema.fromJsonString(HarkActivityContent))

const untilThen = (now: DateTime.Utc, then: DateTime.Utc) =>
  Duration.max(Duration.zero, DateTime.distance(now, then))

const isReached = (now: DateTime.Utc, then: DateTime.Utc) =>
  DateTime.isGreaterThanOrEqualTo(now, then)

const waitAtMost = (duration: Duration.Duration) =>
  ActivityStep.Wait({ atMost: Option.some(duration) })

const bySince = Order.mapInput(DateTime.Order, (agent: ActivityAgent) => agent.since)

const isBusyAgent = (agent: ActivityAgent) =>
  agent.status === 'blocked' || agent.status === 'working'

const activityAgentOf =
  (machineLabel: string, before: MachineAgents) =>
  (row: AgentRow): Option.Option<ActivityAgent> => {
    const settled = settledStatusOf(row)

    if (settled.status === 'unknown') {
      return HashMap.get(before, row.pane)
    }

    return Option.some(
      new ActivityAgent({
        machineLabel,
        title: agentTitleOrPane(row),
        status: settled.status,
        since: settled.statusChangedAt,
        tool: Option.map(permissionOf(row), (permission) => permission.tool),
      }),
    )
  }

const machineAgentsIn = (agents: ActivityHerd, machine: MachineId): MachineAgents =>
  Option.getOrElse(HashMap.get(agents, machine), () => HashMap.empty<PaneId, ActivityAgent>())

const machineAgentsAfter = (
  before: MachineAgents,
  machineLabel: string,
  next: MachineState,
): MachineAgents => {
  const agentOf = activityAgentOf(machineLabel, before)

  return pipe(
    next.agents,
    Arr.map((row) =>
      Option.map(agentOf(row), (agent): [PaneId, ActivityAgent] => [row.pane, agent]),
    ),
    Arr.getSomes,
    HashMap.fromIterable,
  )
}

const hasTurnedBusy = (before: MachineAgents, after: MachineAgents) =>
  Arr.some(
    HashMap.toEntries(after),
    ([pane, agent]) =>
      isBusyAgent(agent) &&
      !Option.exists(HashMap.get(before, pane), (previous) => previous.status === agent.status),
  )

const allAgents = (herd: ActivityHerd) =>
  Arr.flatMap(HashMap.toValues(herd), (agents) => HashMap.toValues(agents))

export const isBusy = (herd: ActivityHerd): boolean => Arr.some(allAgents(herd), isBusyAgent)

const isAwayAt = (
  awayFrom: FollowedHerd['awayFrom'],
  machine: MachineId,
  now: DateTime.Utc,
): boolean => Option.exists(HashMap.get(awayFrom, machine), (from) => isReached(now, from))

export const countedAgents = (
  followed: Pick<FollowedHerd, 'agents' | 'awayFrom'>,
  now: DateTime.Utc,
): ActivityHerd =>
  HashMap.filter(followed.agents, (_agents, machine) => !isAwayAt(followed.awayFrom, machine, now))

const awayNoLaterThan = (
  awayFrom: FollowedHerd['awayFrom'],
  machine: MachineId,
  from: DateTime.Utc,
) =>
  HashMap.set(
    awayFrom,
    machine,
    Option.match(HashMap.get(awayFrom, machine), {
      onNone: () => from,
      onSome: (earlier) => DateTime.min(earlier, from),
    }),
  )

const followedWith = (fields: FollowedFields, held: boolean, now: DateTime.Utc) =>
  new FollowedHerd({
    agents: fields.agents,
    awayFrom: fields.awayFrom,
    busyThroughResync: held && isBusy(countedAgents(fields, now)),
    endsFrom: fields.endsFrom,
  })

export const followedHerdFrom = (hubStartedAt: DateTime.Utc) =>
  new FollowedHerd({
    agents: HashMap.empty(),
    awayFrom: HashMap.empty(),
    busyThroughResync: false,
    endsFrom: DateTime.addDuration(hubStartedAt, RECONNECT_GRACE),
  })

export const activityAfterPublish = (
  followed: FollowedHerd,
  change: {
    readonly machineLabel: string
    readonly previous: Option.Option<MachineState>
    readonly next: MachineState
  },
  now: DateTime.Utc,
): FollowedHerd => {
  const machine = change.next.machine

  if (isHerdrLost(change.next)) {
    return followedWith(
      {
        agents: followed.agents,
        awayFrom: awayNoLaterThan(
          followed.awayFrom,
          machine,
          DateTime.addDuration(now, RECONNECT_GRACE),
        ),
        endsFrom: followed.endsFrom,
      },
      followed.busyThroughResync,
      now,
    )
  }

  const resync = Option.exists(change.previous, (previous) => isResync(previous, change.next))
  const acrossGap = resync || isAwayAt(followed.awayFrom, machine, now)
  const before = machineAgentsIn(followed.agents, machine)
  const after = machineAgentsAfter(before, change.machineLabel, change.next)
  const heldBefore = acrossGap
    ? followed.busyThroughResync || !isBusy(countedAgents(followed, now))
    : followed.busyThroughResync

  return followedWith(
    {
      agents: HashMap.set(followed.agents, machine, after),
      awayFrom: HashMap.remove(followed.awayFrom, machine),
      endsFrom: resync
        ? DateTime.max(followed.endsFrom, DateTime.addDuration(now, RECONNECT_GRACE))
        : followed.endsFrom,
    },
    heldBefore && (resync || !hasTurnedBusy(before, after)),
    now,
  )
}

export const activityAfterOffline = (
  followed: FollowedHerd,
  machine: MachineId,
  now: DateTime.Utc,
): FollowedHerd =>
  HashMap.has(followed.agents, machine)
    ? followedWith(
        {
          agents: followed.agents,
          awayFrom: awayNoLaterThan(followed.awayFrom, machine, now),
          endsFrom: followed.endsFrom,
        },
        followed.busyThroughResync,
        now,
      )
    : followed

export const activityAfterForgotten = (
  followed: FollowedHerd,
  machine: MachineId,
  now: DateTime.Utc,
): FollowedHerd =>
  followedWith(
    {
      agents: HashMap.remove(followed.agents, machine),
      awayFrom: HashMap.remove(followed.awayFrom, machine),
      endsFrom: followed.endsFrom,
    },
    followed.busyThroughResync,
    now,
  )

export const wakeWithin = (
  followed: FollowedHerd,
  now: DateTime.Utc,
  atMost: Option.Option<Duration.Duration>,
): Option.Option<Duration.Duration> =>
  pipe(
    HashMap.toValues(followed.awayFrom),
    Arr.filter((from) => !isReached(now, from)),
    Arr.map((from) => untilThen(now, from)),
    Arr.appendAll(Option.toArray(atMost)),
    Arr.match({
      onEmpty: () => Option.none(),
      onNonEmpty: (durations) => Option.some(Arr.min(durations, Duration.Order)),
    }),
  )

export const activityStartKey = (
  record: Option.Option<LiveActivityRecord>,
  content: HarkActivityContent,
): string =>
  [
    ACTIVITY_START_KEY_PREFIX,
    Option.match(record, {
      onNone: () => 'first',
      onSome: (live) => DateTime.formatIso(live.lastStartAt),
    }),
    String(Hash.string(encodeContent(content))),
  ].join('/')

const agentsWith = (herd: ActivityHerd, status: AgentStatus) =>
  pipe(
    allAgents(herd),
    Arr.filter((agent) => agent.status === status),
    Arr.sort(bySince),
  )

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

export const herdContent = (herd: ActivityHerd): HarkActivityContent => {
  const blocked = agentsWith(herd, 'blocked')
  const working = agentsWith(herd, 'working')
  const workingPart = Arr.isReadonlyArrayNonEmpty(working) ? [workingLine(working.length)] : []

  return pipe(
    Arr.head(blocked),
    Option.map((oldest) =>
      cutContent(
        [needsYouLabel(blocked.length), ...workingPart].join(' · '),
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

const restartAtOf = (record: LiveActivityRecord) =>
  DateTime.addDuration(
    record.lastStartAt,
    Duration.subtract(HARK_ACTIVITY_LIFETIME, ACTIVITY_RESTART_LEAD_OF_ONE_RATE_WINDOW),
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
  readonly followed: FollowedHerd
  readonly enabled: boolean
  readonly record: Option.Option<LiveActivityRecord>
  readonly now: DateTime.Utc
}): ActivityStep => {
  const shown = shownIn(input.record)
  const herd = countedAgents(input.followed, input.now)

  if (!input.enabled) {
    return Option.match(shown, {
      onNone: () => WAIT_FOR_A_CHANGE,
      onSome: (content) => ActivityStep.End({ content, linger: Duration.zero }),
    })
  }

  if (!isBusy(herd)) {
    return Option.match(shown, {
      onNone: () => WAIT_FOR_A_CHANGE,
      onSome: () => endWhenAllowed(input.now, input.followed.endsFrom),
    })
  }

  const content = herdContent(herd)

  return Option.match(Option.all({ record: input.record, shown }), {
    onNone: () =>
      input.followed.busyThroughResync
        ? WAIT_FOR_A_CHANGE
        : startWhenSpaced(input.now, input.record, content),
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
