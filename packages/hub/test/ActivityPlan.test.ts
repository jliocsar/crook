import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'

import type { AgentRow } from '@crook/domain/AgentRow'
import { HerdrLink } from '@crook/domain/HerdrLink'
import { HerdrConnectionId, MachineId, PaneId, TerminalId } from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import {
  ACTIVITY_RESTART_MARGIN,
  ACTIVITY_START_SPACING,
  ALL_DONE,
  ALL_DONE_LINGER,
  type ActivityHerd,
  ActivityStep,
  LiveActivityRecord,
  WAIT_FOR_A_CHANGE,
  activityAfterPublish,
  herdContent,
  nextActivityStep,
} from '@crook/hub/ActivityPlan'
import { HARK_ACTIVITY_LIFETIME, HarkActivityContent } from '@crook/hub/HarkClient'

import { agentRow, bashAsk } from './Fixtures'

const LAPTOP = MachineId.make('laptop')
const DESK = MachineId.make('desk')
const STARTED_AT = DateTime.makeUnsafe(0)

const stateOf = (
  machine: MachineId,
  agents: readonly AgentRow[],
  herdr: { readonly connection?: number; readonly lost?: boolean } = {},
) =>
  new MachineState({
    machine,
    version: MachineStateVersion.make(1),
    herdrVersion: '0.9.5',
    herdr: new HerdrLink({
      connection: HerdrConnectionId.make(herdr.connection ?? 1),
      lostAt: herdr.lost === true ? Option.some(DateTime.makeUnsafe(0)) : Option.none(),
    }),
    workspaces: [],
    tabs: [],
    panes: [],
    agents,
    places: [],
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

const emptyHerd: ActivityHerd = HashMap.empty()

const herdOf = (...states: readonly MachineState[]): ActivityHerd =>
  Arr.reduce(states, emptyHerd, (herd, next) =>
    activityAfterPublish(herd, { machineLabel: next.machine, previous: Option.none(), next }),
  )

const busyHerd = herdOf(stateOf(LAPTOP, [agentAt('w1:p1', 'Port the herd', 'working', 5)]))

const WORKING = herdContent(busyHerd)

const liveSince = (startedAt: DateTime.Utc, shown: HarkActivityContent) =>
  Option.some(new LiveActivityRecord({ lastStartAt: startedAt, shown: Option.some(shown) }))

const stepAt = (
  herd: ActivityHerd,
  record: Option.Option<LiveActivityRecord>,
  elapsed: Duration.Duration,
  enabled = true,
) =>
  nextActivityStep({
    herd,
    enabled,
    record,
    now: DateTime.addDuration(STARTED_AT, elapsed),
    endsFrom: STARTED_AT,
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

    expect(herdContent(herd)).toEqual(
      new HarkActivityContent({
        status: '2 need you · 2 working',
        detail: Option.some('Prototype the herd screen wants Bash · laptop'),
        symbol: 'warning',
      }),
    )
    expect(herdContent(herdOf(stateOf(DESK, [agentAt('w1:p1', 'Notes', 'blocked', 30)])))).toEqual(
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

    expect(herdContent(working)).toEqual(
      new HarkActivityContent({
        status: '3 working',
        detail: Option.some('Latest · laptop'),
        symbol: 'terminal',
      }),
    )
    expect(herdContent(herdOf(stateOf(LAPTOP, [agentAt('w1:p1', 'Done', 'done', 1)])))).toEqual(
      ALL_DONE,
    )
  })

  it('cuts the detail to Hark limit', () => {
    const herd = herdOf(stateOf(LAPTOP, [agentAt('w1:p1', 'x'.repeat(300), 'working', 1)]))

    expect(Option.map(herdContent(herd).detail, (detail) => detail.length)).toEqual(
      Option.some(240),
    )
  })
})

describe('activityAfterPublish', () => {
  it('ignores a resync diff and a lost herdr, and keeps an agent not known yet as it was', () => {
    const known = herdOf(stateOf(LAPTOP, [agentAt('w1:p1', 'Port the herd', 'working', 5)]))
    const previous = Option.some(stateOf(LAPTOP, []))

    expect(
      activityAfterPublish(known, {
        machineLabel: 'laptop',
        previous,
        next: stateOf(LAPTOP, [], { connection: 2 }),
      }),
    ).toEqual(known)
    expect(
      activityAfterPublish(known, {
        machineLabel: 'laptop',
        previous,
        next: stateOf(LAPTOP, [], { lost: true }),
      }),
    ).toEqual(known)
    expect(
      herdContent(
        activityAfterPublish(known, {
          machineLabel: 'laptop',
          previous,
          next: stateOf(LAPTOP, [agentAt('w1:p1', 'Port the herd', 'unknown', 9)]),
        }),
      ),
    ).toEqual(WORKING)
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
    const restartAfter = Duration.subtract(HARK_ACTIVITY_LIFETIME, ACTIVITY_RESTART_MARGIN)

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
