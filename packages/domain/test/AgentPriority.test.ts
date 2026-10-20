import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'

import {
  herdNeedsYouCount,
  needsYou,
  needsYouCount,
  orderAgents,
} from '@crook/domain/AgentPriority'
import { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdMachine, HerdView } from '@crook/domain/HerdView'
import { HerdrConnectionId, HerdrLink } from '@crook/domain/HerdrLink'
import { MachineId, PaneId, TabId, TerminalId, WorkspaceId } from '@crook/domain/Ids'
import { Machine, type MachineConnection } from '@crook/domain/Machine'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'

const START = DateTime.makeUnsafe('2026-10-20T09:00:00.000Z')

const agent = (pane: string, status: AgentStatus, minutesIn: number) =>
  new AgentRow({
    pane: PaneId.make(pane),
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    terminal: TerminalId.make(`term_${pane}`),
    status,
    title: pane,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq: 1,
    statusChangedAt: DateTime.addDuration(START, Duration.minutes(minutesIn)),
  })

const machineWith = (
  agents: readonly AgentRow[],
  options: {
    readonly seen?: readonly string[]
    readonly connection?: MachineConnection
    readonly published?: boolean
  } = {},
) => {
  const id = MachineId.make('laptop')

  return new HerdMachine({
    machine: new Machine({
      id,
      label: 'laptop',
      connection: options.connection ?? 'online',
      connectionChangedAt: START,
      lastSeenAt: START,
      agentVersion: Option.none(),
      herdrVersion: Option.none(),
    }),
    state: Option.liftPredicate(
      new MachineState({
        machine: id,
        version: MachineStateVersion.make(1),
        herdrVersion: '0.9.1',
        herdr: new HerdrLink({ connection: HerdrConnectionId.make(1), lostAt: Option.none() }),
        workspaces: [],
        tabs: [],
        panes: [],
        agents,
      }),
      () => options.published ?? true,
    ),
    seen: (options.seen ?? []).map((pane) => PaneId.make(pane)),
  })
}

const panesOf = (rows: readonly AgentRow[]) => rows.map((row) => row.pane)

describe('orderAgents', () => {
  it('puts blocked first, then unseen done, working, settled and unknown', () => {
    const machine = machineWith(
      [
        agent('unknown', 'unknown', 0),
        agent('idle', 'idle', 0),
        agent('working', 'working', 0),
        agent('seen-done', 'done', 0),
        agent('unseen-done', 'done', 0),
        agent('blocked', 'blocked', 0),
      ],
      { seen: ['seen-done'] },
    )

    expect(panesOf(orderAgents(machine))).toEqual([
      'blocked',
      'unseen-done',
      'working',
      'idle',
      'seen-done',
      'unknown',
    ])
  })

  it('lists the longest-waiting blocked agent first and the newest unseen done first', () => {
    const machine = machineWith([
      agent('done-early', 'done', 1),
      agent('blocked-late', 'blocked', 5),
      agent('done-late', 'done', 9),
      agent('blocked-early', 'blocked', 2),
    ])

    expect(panesOf(orderAgents(machine))).toEqual([
      'blocked-early',
      'blocked-late',
      'done-late',
      'done-early',
    ])
  })

  it('keeps the published order inside the working, settled and unknown tiers', () => {
    const machine = machineWith(
      [
        agent('working-new', 'working', 9),
        agent('idle-new', 'idle', 9),
        agent('working-old', 'working', 1),
        agent('done-seen-old', 'done', 1),
      ],
      { seen: ['done-seen-old'] },
    )

    expect(panesOf(orderAgents(machine))).toEqual([
      'working-new',
      'working-old',
      'idle-new',
      'done-seen-old',
    ])
  })

  it('has nothing to order before the machine has published a state', () => {
    const machine = machineWith([agent('blocked', 'blocked', 0)], { published: false })

    expect(orderAgents(machine)).toEqual([])
  })
})

describe('needs you', () => {
  it('counts blocked and unseen done agents, never working, idle or seen done ones', () => {
    const machine = machineWith(
      [
        agent('blocked', 'blocked', 0),
        agent('unseen-done', 'done', 0),
        agent('seen-done', 'done', 0),
        agent('working', 'working', 0),
        agent('idle', 'idle', 0),
        agent('unknown', 'unknown', 0),
      ],
      { seen: ['seen-done'] },
    )

    expect(needsYouCount(machine)).toBe(2)
    expect(machine.state.pipe(Option.map((state) => state.agents.map(needsYou(machine))))).toEqual(
      Option.some([true, true, false, false, false, false]),
    )
  })

  it('ignores offline machines, whose agents are unknown, but counts reconnecting ones', () => {
    const agents = [agent('blocked', 'blocked', 0)]
    const herd = new HerdView({
      hubVersion: CrookVersion.make('0.0.1'),
      machines: [
        machineWith(agents),
        machineWith(agents, { connection: 'reconnecting' }),
        machineWith(agents, { connection: 'offline' }),
      ],
    })

    expect(herdNeedsYouCount(herd)).toBe(2)
  })
})
