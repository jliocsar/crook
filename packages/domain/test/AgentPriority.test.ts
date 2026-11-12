import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'

import {
  herdNeedsYouCount,
  needsYou,
  needsYouCount,
  noOrderHints,
  orderAgents,
} from '@crook/domain/AgentPriority'
import type { OrderHints } from '@crook/domain/AgentPriority'
import { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdMachine, HerdView } from '@crook/domain/HerdView'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  HerdrConnectionId,
  MachineId,
  PaneId,
  TabId,
  TerminalId,
  toGlobalPaneId,
  WorkspaceId,
} from '@crook/domain/Ids'
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
    label: Option.none(),
    createdByCrook: false,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq: 1,
    statusChangedAt: DateTime.addDuration(START, Duration.minutes(minutesIn)),
    beforeHandoff: Option.none(),
    ask: Option.none(),
    runningSubagents: Option.none(),
    claudeWaiting: Option.none(),
  })

const machineWith = (
  agents: readonly AgentRow[],
  options: {
    readonly seen?: readonly string[]
    readonly pinned?: readonly string[]
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
        places: [],
      }),
      () => options.published ?? true,
    ),
    seen: (options.seen ?? []).map((pane) => PaneId.make(pane)),
    pinned: (options.pinned ?? []).map((pane) => PaneId.make(pane)),
  })
}

const panesOf = (rows: readonly AgentRow[]) => rows.map((row) => row.pane)

const LAPTOP = MachineId.make('laptop')

const hintsWith = (options: {
  readonly drafted?: readonly string[]
  readonly openedMinutesIn?: Readonly<Record<string, number>>
}): OrderHints => ({
  drafted: HashSet.fromIterable(
    (options.drafted ?? []).map((pane) => toGlobalPaneId(LAPTOP, PaneId.make(pane))),
  ),
  openedAt: {
    [LAPTOP]: Object.fromEntries(
      Object.entries(options.openedMinutesIn ?? {}).map(([pane, minutesIn]) => [
        PaneId.make(pane),
        DateTime.addDuration(START, Duration.minutes(minutesIn)),
      ]),
    ),
  },
})

describe('orderAgents', () => {
  it('puts blocked first, then unseen done, then the rest in the published order', () => {
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

    expect(panesOf(orderAgents(machine, noOrderHints))).toEqual([
      'blocked',
      'unseen-done',
      'unknown',
      'idle',
      'working',
      'seen-done',
    ])
  })

  it('lists the longest-waiting blocked agent first and the newest unseen done first', () => {
    const machine = machineWith([
      agent('done-early', 'done', 1),
      agent('blocked-late', 'blocked', 5),
      agent('done-late', 'done', 9),
      agent('blocked-early', 'blocked', 2),
    ])

    expect(panesOf(orderAgents(machine, noOrderHints))).toEqual([
      'blocked-early',
      'blocked-late',
      'done-late',
      'done-early',
    ])
  })

  it('lists the rest by when their chat was last opened, the never opened after in the published order', () => {
    const machine = machineWith([
      agent('never-a', 'working', 0),
      agent('opened-early', 'idle', 0),
      agent('never-b', 'unknown', 0),
      agent('opened-late', 'working', 0),
    ])
    const hints = hintsWith({ openedMinutesIn: { 'opened-early': 1, 'opened-late': 7 } })

    expect(panesOf(orderAgents(machine, hints))).toEqual([
      'opened-late',
      'opened-early',
      'never-a',
      'never-b',
    ])
  })

  it('keeps a card in place when its agent flips between working and settled', () => {
    const statuses = (first: AgentStatus, second: AgentStatus) =>
      machineWith(
        [agent('first', first, 0), agent('second', second, 4), agent('third', 'idle', 9)],
        { seen: ['first', 'second'] },
      )
    const hints = hintsWith({ openedMinutesIn: { first: 3, second: 2 } })

    expect(panesOf(orderAgents(statuses('working', 'idle'), hints))).toEqual(
      panesOf(orderAgents(statuses('done', 'working'), hints)),
    )
  })

  it('puts pinned agents first, ordered among themselves like the rest', () => {
    const machine = machineWith(
      [
        agent('blocked', 'blocked', 0),
        agent('pinned-idle', 'idle', 0),
        agent('working', 'working', 0),
        agent('pinned-blocked', 'blocked', 3),
      ],
      { pinned: ['pinned-idle', 'pinned-blocked'] },
    )

    expect(panesOf(orderAgents(machine, noOrderHints))).toEqual([
      'pinned-blocked',
      'pinned-idle',
      'blocked',
      'working',
    ])
  })

  it('puts agents with a draft after the pinned ones and before everything else', () => {
    const machine = machineWith(
      [
        agent('blocked', 'blocked', 0),
        agent('drafted-idle', 'idle', 0),
        agent('pinned-working', 'working', 0),
        agent('drafted-blocked', 'blocked', 3),
        agent('pinned-drafted', 'idle', 0),
      ],
      { pinned: ['pinned-working', 'pinned-drafted'] },
    )
    const hints = hintsWith({ drafted: ['drafted-idle', 'drafted-blocked', 'pinned-drafted'] })

    expect(panesOf(orderAgents(machine, hints))).toEqual([
      'pinned-drafted',
      'pinned-working',
      'drafted-blocked',
      'drafted-idle',
      'blocked',
    ])
  })

  it('reads drafts and opened times for its own machine only', () => {
    const machine = machineWith([agent('w1:p1', 'idle', 0), agent('w1:p2', 'idle', 0)])
    const elsewhere = MachineId.make('desk')
    const hints: OrderHints = {
      drafted: HashSet.make(toGlobalPaneId(elsewhere, PaneId.make('w1:p2'))),
      openedAt: { [elsewhere]: { [PaneId.make('w1:p2')]: START } },
    }

    expect(panesOf(orderAgents(machine, hints))).toEqual(['w1:p1', 'w1:p2'])
  })

  it('still counts a pinned agent that needs you, and never counts one for being pinned', () => {
    const machine = machineWith([agent('blocked', 'blocked', 0), agent('idle', 'idle', 0)], {
      pinned: ['blocked', 'idle'],
    })

    expect(needsYouCount(machine)).toBe(1)
  })

  it('has nothing to order before the machine has published a state', () => {
    const machine = machineWith([agent('blocked', 'blocked', 0)], { published: false })

    expect(orderAgents(machine, noOrderHints)).toEqual([])
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
