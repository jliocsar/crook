import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'

import { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { CrookVersion } from '@crook/domain/CrookVersion'
import {
  HerdReplaced,
  HerdUpdate,
  MachineLeft,
  MachineReplaced,
  applyHerdUpdate,
  herdUpdates,
  herdViews,
} from '@crook/domain/HerdUpdate'
import { HerdMachine, HerdView } from '@crook/domain/HerdView'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  HerdrConnectionId,
  MachineId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from '@crook/domain/Ids'
import { Machine } from '@crook/domain/Machine'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'

const DESK = MachineId.make('desk')
const LAPTOP = MachineId.make('laptop')
const VM = MachineId.make('vm-1')
const HUB_VERSION = CrookVersion.make('0.1.0')

const observedAt = DateTime.makeUnsafe('2026-10-21T12:00:00.000Z')

const agentRow = (status: AgentStatus) =>
  new AgentRow({
    pane: PaneId.make('w1:p1'),
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    terminal: TerminalId.make('term_1'),
    status,
    title: 'JC-94 End-to-end check',
    label: Option.none(),
    createdByCrook: false,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.some('feat/jc-94-e2e'),
    claudeSession: Option.none(),
    stateChangeSeq: 7,
    statusChangedAt: observedAt,
    beforeHandoff: Option.none(),
    ask: Option.none(),
    runningSubagents: Option.none(),
    claudeWaiting: Option.none(),
  })

const entry = (machine: MachineId, status: AgentStatus) =>
  new HerdMachine({
    machine: new Machine({
      id: machine,
      label: machine,
      connection: 'online',
      connectionChangedAt: observedAt,
      lastSeenAt: observedAt,
      agentVersion: Option.some(HUB_VERSION),
      herdrVersion: Option.some('0.9.1'),
    }),
    state: Option.some(
      new MachineState({
        machine,
        version: MachineStateVersion.make(1),
        herdrVersion: '0.9.1',
        herdr: new HerdrLink({ connection: HerdrConnectionId.make(1), lostAt: Option.none() }),
        workspaces: [],
        tabs: [],
        panes: [],
        agents: [agentRow(status)],
        places: [],
      }),
    ),
    seen: [],
    pinned: [],
  })

const herdOf = (...machines: readonly HerdMachine[]) =>
  new HerdView({ hubVersion: HUB_VERSION, machines })

const first = herdOf(entry(LAPTOP, 'working'), entry(VM, 'idle'))
const laptopBlocked = herdOf(entry(LAPTOP, 'blocked'), entry(VM, 'idle'))
const deskJoined = herdOf(entry(DESK, 'done'), entry(LAPTOP, 'blocked'), entry(VM, 'idle'))
const vmForgotten = herdOf(entry(DESK, 'done'), entry(LAPTOP, 'blocked'))
const views = [first, laptopBlocked, laptopBlocked, deskJoined, vmForgotten]

const roundTrip = Schema.decodeSync(Schema.fromJsonString(Schema.toCodecJson(HerdUpdate)))
const encode = Schema.encodeSync(Schema.fromJsonString(Schema.toCodecJson(HerdUpdate)))

describe('HerdUpdate', () => {
  it.effect('sends the whole herd once, then only the machines that changed or left', () =>
    Effect.gen(function* () {
      const updates = yield* Stream.fromIterable(views).pipe(herdUpdates, Stream.runCollect)

      expect(updates).toEqual([
        new HerdReplaced({ herd: first }),
        new MachineReplaced({ entry: entry(LAPTOP, 'blocked') }),
        new MachineReplaced({ entry: entry(DESK, 'done') }),
        new MachineLeft({ machine: VM }),
      ])
    }),
  )

  it.effect('folds the updates back into every herd the hub saw, machines in id order', () =>
    Effect.gen(function* () {
      const folded = yield* Stream.fromIterable(views).pipe(
        herdUpdates,
        Stream.map((update) => roundTrip(encode(update))),
        herdViews,
        Stream.runCollect,
      )

      expect(folded).toEqual([first, laptopBlocked, deskJoined, vmForgotten])
    }),
  )

  it('replaces the herd when the hub behind it changed version', () => {
    const upgraded = new HerdView({ hubVersion: CrookVersion.make('0.2.0'), machines: [] })

    expect(applyHerdUpdate(Option.some(first), new HerdReplaced({ herd: upgraded }))).toEqual(
      Option.some(upgraded),
    )
  })

  it('holds nothing until the whole herd has arrived', () => {
    expect(
      applyHerdUpdate(Option.none(), new MachineReplaced({ entry: entry(LAPTOP, 'blocked') })),
    ).toEqual(Option.none())
  })
})
