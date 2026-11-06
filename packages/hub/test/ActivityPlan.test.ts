import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'

import { RECONNECT_GRACE } from '@crook/protocol/LinkTiming'
import type { AgentRow } from '@crook/domain/AgentRow'
import { MachineId, PaneId, TerminalId } from '@crook/domain/Ids'
import type { MachineState } from '@crook/domain/MachineState'
import {
  ACTIVITY_RESTART_LEAD_OF_ONE_RATE_WINDOW,
  ACTIVITY_START_SPACING,
  ALL_DONE,
  ALL_DONE_LINGER,
  ActivityStep,
  FollowedHerd,
  LiveActivityRecord,
  WAIT_FOR_A_CHANGE,
  activityAfterOffline,
  activityAfterPublish,
  activityStartKey,
  countedAgents,
  herdContent,
  nextActivityStep,
  wakeWithin,
} from '@crook/hub/ActivityPlan'
import {
  HARK_ACTIVITY_LIFETIME,
  HARK_IDEMPOTENCY_KEY_LIMIT,
  HarkActivityContent,
} from '@crook/hub/HarkClient'

import { agentRow, bashAsk, herdrLinkOf, machineStateWith } from './Fixtures'

const LAPTOP = MachineId.make('laptop')
const DESK = MachineId.make('desk')
const STARTED_AT = DateTime.makeUnsafe(0)

const stateOf = (
  machine: MachineId,
  agents: readonly AgentRow[],
  herdr: { readonly connection?: number; readonly lost?: boolean } = {},
) =>
  machineStateWith(machine, 1, agents, {
    herdr: herdrLinkOf(
      herdr.connection ?? 1,
      herdr.lost === true ? Option.some(DateTime.makeUnsafe(0)) : Option.none(),
    ),
  })

const agentAt = (
  pane: string,
  title: string,
  status: AgentRow['status'],
  changedAtSeconds: number,
  fields: Partial<ConstructorParameters<typeof AgentRow>[0]> = {},
) =>
  agentRow({
    pane: PaneId.make(pane),
    terminal: TerminalId.make(`term_${pane}`),
    title,
    status,
    statusChangedAt: DateTime.makeUnsafe(changedAtSeconds * 1000),
    ...fields,
  })

const emptyHerd = new FollowedHerd({
  agents: HashMap.empty(),
  awayFrom: HashMap.empty(),
  busyThroughResync: false,
  endsFrom: STARTED_AT,
})

const herdOf = (...states: readonly MachineState[]): FollowedHerd =>
  Arr.reduce(states, emptyHerd, (followed, next) =>
    activityAfterPublish(
      followed,
      { machineLabel: next.machine, previous: Option.none(), next },
      STARTED_AT,
    ),
  )

const contentOf = (followed: FollowedHerd, elapsed = Duration.zero) =>
  herdContent(countedAgents(followed, DateTime.addDuration(STARTED_AT, elapsed)))

const laptopWorking = stateOf(LAPTOP, [agentAt('w1:p1', 'Port the herd', 'working', 5)])

const busyHerd = herdOf(laptopWorking)

const WORKING = contentOf(busyHerd)

const liveSince = (startedAt: DateTime.Utc, shown: HarkActivityContent) =>
  Option.some(new LiveActivityRecord({ lastStartAt: startedAt, shown: Option.some(shown) }))

const stepAt = (
  followed: FollowedHerd,
  record: Option.Option<LiveActivityRecord>,
  elapsed: Duration.Duration,
  enabled = true,
) =>
  nextActivityStep({
    followed,
    enabled,
    record,
    now: DateTime.addDuration(STARTED_AT, elapsed),
  })

describe('herdContent', () => {
  it('names the herd in one line, and the agent that has waited longest', () => {
    const herd = herdOf(
      stateOf(LAPTOP, [
        agentAt('w1:p1', 'Prototype the herd screen', 'blocked', 10, {
          ask: Option.some(bashAsk('toolu_1')),
        }),
        agentAt('w1:p2', 'Port the herd', 'working', 20),
      ]),
      stateOf(DESK, [
        agentAt('w1:p1', 'Notes', 'blocked', 30),
        agentAt('w1:p2', 'Docs', 'working', 40),
        agentAt('w1:p3', 'Old', 'done', 1),
      ]),
    )

    expect(contentOf(herd)).toEqual(
      new HarkActivityContent({
        status: '2 need you · 2 working',
        detail: Option.some('Prototype the herd screen wants Bash · laptop'),
        symbol: 'warning',
      }),
    )
    expect(contentOf(herdOf(stateOf(DESK, [agentAt('w1:p1', 'Notes', 'blocked', 30)])))).toEqual(
      new HarkActivityContent({
        status: '1 needs you',
        detail: Option.some('Notes has a question · desk'),
        symbol: 'warning',
      }),
    )
  })

  it('names the latest working agent while nothing waits, and All done once nothing works', () => {
    const working = herdOf(
      stateOf(LAPTOP, [
        agentAt('w1:p1', 'First', 'working', 10),
        agentAt('w1:p2', 'Latest', 'working', 50),
        agentAt('w1:p3', 'Middle', 'working', 30),
      ]),
    )

    expect(contentOf(working)).toEqual(
      new HarkActivityContent({
        status: '3 working',
        detail: Option.some('Latest · laptop'),
        symbol: 'terminal',
      }),
    )
    expect(contentOf(herdOf(stateOf(LAPTOP, [agentAt('w1:p1', 'Done', 'done', 1)])))).toEqual(
      ALL_DONE,
    )
  })

  it('cuts the detail to Hark limit', () => {
    const herd = herdOf(stateOf(LAPTOP, [agentAt('w1:p1', 'x'.repeat(300), 'working', 1)]))

    expect(Option.map(contentOf(herd).detail, (detail) => detail.length)).toEqual(Option.some(240))
  })
})

describe('activityAfterPublish', () => {
  it('keeps the agents of a lost herdr for a grace, then stops counting them', () => {
    const lostAt = Duration.seconds(30)
    const lost = activityAfterPublish(
      busyHerd,
      {
        machineLabel: 'laptop',
        previous: Option.some(laptopWorking),
        next: stateOf(LAPTOP, [], { lost: true }),
      },
      DateTime.addDuration(STARTED_AT, lostAt),
    )
    const graceLater = Duration.sum(lostAt, RECONNECT_GRACE)

    expect(contentOf(lost, lostAt)).toEqual(WORKING)
    expect(wakeWithin(lost, DateTime.addDuration(STARTED_AT, lostAt), Option.none())).toEqual(
      Option.some(RECONNECT_GRACE),
    )
    expect(contentOf(lost, graceLater)).toEqual(ALL_DONE)
    expect(stepAt(lost, liveSince(STARTED_AT, WORKING), graceLater)).toEqual(
      ActivityStep.End({ content: ALL_DONE, linger: ALL_DONE_LINGER }),
    )
  })

  it('stops counting an offline machine, and starts nothing when it comes back unchanged', () => {
    const offlineAt = Duration.seconds(30)
    const backAt = Duration.seconds(90)
    const offline = activityAfterOffline(
      busyHerd,
      LAPTOP,
      DateTime.addDuration(STARTED_AT, offlineAt),
    )
    const back = activityAfterPublish(
      offline,
      { machineLabel: 'laptop', previous: Option.some(laptopWorking), next: laptopWorking },
      DateTime.addDuration(STARTED_AT, backAt),
    )
    const turnedBusy = activityAfterPublish(
      back,
      {
        machineLabel: 'laptop',
        previous: Option.some(laptopWorking),
        next: stateOf(LAPTOP, [agentAt('w1:p1', 'Port the herd', 'blocked', 95)]),
      },
      DateTime.addDuration(STARTED_AT, backAt),
    )

    expect(stepAt(offline, liveSince(STARTED_AT, WORKING), offlineAt)).toEqual(
      ActivityStep.End({ content: ALL_DONE, linger: ALL_DONE_LINGER }),
    )
    expect(contentOf(back, backAt)).toEqual(WORKING)
    expect(stepAt(back, Option.none(), backAt)).toEqual(WAIT_FOR_A_CHANGE)
    expect(stepAt(turnedBusy, Option.none(), backAt)).toEqual(
      ActivityStep.Start({ content: contentOf(turnedBusy, backAt) }),
    )
  })

  it('keeps an agent not known yet as it was', () => {
    const previous = Option.some(stateOf(LAPTOP, []))
    const notKnownYet = activityAfterPublish(
      busyHerd,
      {
        machineLabel: 'laptop',
        previous,
        next: stateOf(LAPTOP, [agentAt('w1:p1', 'Port the herd', 'unknown', 9)]),
      },
      STARTED_AT,
    )

    expect(contentOf(notKnownYet)).toEqual(WORKING)
  })

  it('follows a resync that empties the herd, and ends the card only a grace after it', () => {
    const resyncAt = Duration.seconds(30)
    const emptied = activityAfterPublish(
      busyHerd,
      {
        machineLabel: 'laptop',
        previous: Option.some(stateOf(LAPTOP, [])),
        next: stateOf(LAPTOP, [], { connection: 2 }),
      },
      DateTime.addDuration(STARTED_AT, resyncAt),
    )
    const live = liveSince(STARTED_AT, WORKING)

    expect(contentOf(emptied)).toEqual(ALL_DONE)
    expect(stepAt(emptied, live, resyncAt)).toEqual(
      ActivityStep.Wait({ atMost: Option.some(RECONNECT_GRACE) }),
    )
    expect(stepAt(emptied, live, Duration.sum(resyncAt, RECONNECT_GRACE))).toEqual(
      ActivityStep.End({ content: ALL_DONE, linger: ALL_DONE_LINGER }),
    )
  })

  it('starts no card for a herd a resync turned busy, until an agent really turns busy', () => {
    const idle = herdOf(stateOf(LAPTOP, [agentAt('w1:p1', 'Port the herd', 'done', 5)]))
    const resynced = stateOf(LAPTOP, [agentAt('w1:p1', 'Port the herd', 'working', 6)], {
      connection: 2,
    })
    const busyThroughResync = activityAfterPublish(
      idle,
      { machineLabel: 'laptop', previous: Option.some(stateOf(LAPTOP, [])), next: resynced },
      STARTED_AT,
    )
    const stillTheSame = activityAfterPublish(
      busyThroughResync,
      { machineLabel: 'laptop', previous: Option.some(resynced), next: resynced },
      STARTED_AT,
    )
    const turnedBusy = activityAfterPublish(
      stillTheSame,
      {
        machineLabel: 'laptop',
        previous: Option.some(resynced),
        next: stateOf(
          LAPTOP,
          [
            agentAt('w1:p1', 'Port the herd', 'working', 6),
            agentAt('w1:p2', 'Notes', 'working', 9),
          ],
          { connection: 2 },
        ),
      },
      STARTED_AT,
    )

    expect(stepAt(busyThroughResync, Option.none(), Duration.zero)).toEqual(WAIT_FOR_A_CHANGE)
    expect(stepAt(stillTheSame, Option.none(), Duration.zero)).toEqual(WAIT_FOR_A_CHANGE)
    expect(stepAt(turnedBusy, Option.none(), Duration.zero)).toEqual(
      ActivityStep.Start({ content: contentOf(turnedBusy) }),
    )
  })
})

describe('activityStartKey', () => {
  it('names the same start the same way, and any other start another way', () => {
    const ended = Option.some(
      new LiveActivityRecord({ lastStartAt: STARTED_AT, shown: Option.none() }),
    )
    const later = Option.some(
      new LiveActivityRecord({
        lastStartAt: DateTime.addDuration(STARTED_AT, ACTIVITY_START_SPACING),
        shown: Option.none(),
      }),
    )
    const key = activityStartKey(ended, WORKING)

    expect(activityStartKey(ended, WORKING)).toBe(key)
    expect(activityStartKey(later, WORKING)).not.toBe(key)
    expect(activityStartKey(ended, ALL_DONE)).not.toBe(key)
    expect(activityStartKey(Option.none(), WORKING)).not.toBe(key)
    expect(key.length).toBeLessThanOrEqual(HARK_IDEMPOTENCY_KEY_LIMIT)
  })
})

describe('nextActivityStep', () => {
  it('starts when the herd turns busy, at least a minute after the last start', () => {
    const ended = Option.some(
      new LiveActivityRecord({ lastStartAt: STARTED_AT, shown: Option.none() }),
    )

    expect(stepAt(busyHerd, Option.none(), Duration.zero)).toEqual(
      ActivityStep.Start({ content: WORKING }),
    )
    expect(stepAt(busyHerd, ended, Duration.seconds(20))).toEqual(
      ActivityStep.Wait({ atMost: Option.some(Duration.seconds(40)) }),
    )
    expect(stepAt(busyHerd, ended, ACTIVITY_START_SPACING)).toEqual(
      ActivityStep.Start({ content: WORKING }),
    )
  })

  it('updates only when the content changes, and restarts a margin before Hark expires it', () => {
    const restartAfter = Duration.subtract(
      HARK_ACTIVITY_LIFETIME,
      ACTIVITY_RESTART_LEAD_OF_ONE_RATE_WINDOW,
    )

    expect(stepAt(busyHerd, liveSince(STARTED_AT, WORKING), Duration.seconds(5))).toEqual(
      ActivityStep.Wait({
        atMost: Option.some(Duration.subtract(restartAfter, Duration.seconds(5))),
      }),
    )
    expect(stepAt(busyHerd, liveSince(STARTED_AT, ALL_DONE), Duration.seconds(5))).toEqual(
      ActivityStep.Update({ content: WORKING }),
    )
    expect(stepAt(busyHerd, liveSince(STARTED_AT, WORKING), restartAfter)).toEqual(
      ActivityStep.Start({ content: WORKING }),
    )
  })

  it('ends on All done with a linger, and at once when the switch is off', () => {
    const idle = herdOf(stateOf(LAPTOP, [agentAt('w1:p1', 'Done', 'done', 1)]))

    expect(stepAt(idle, liveSince(STARTED_AT, WORKING), Duration.seconds(5))).toEqual(
      ActivityStep.End({ content: ALL_DONE, linger: ALL_DONE_LINGER }),
    )
    expect(stepAt(idle, Option.none(), Duration.seconds(5))).toEqual(WAIT_FOR_A_CHANGE)
    expect(stepAt(busyHerd, liveSince(STARTED_AT, WORKING), Duration.seconds(5), false)).toEqual(
      ActivityStep.End({ content: WORKING, linger: Duration.zero }),
    )
    expect(stepAt(busyHerd, Option.none(), Duration.seconds(5), false)).toEqual(WAIT_FOR_A_CHANGE)
  })
})
