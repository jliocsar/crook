import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import * as RpcSerialization from 'effect/rpc/RpcSerialization'

import { RECENT_PLACES_CAPACITY } from '@crook/agent/RecentPlaces'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdReplaced, HerdUpdate, MachineReplaced } from '@crook/domain/HerdUpdate'
import { HerdMachine, HerdView } from '@crook/domain/HerdView'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  ClaudeSessionId,
  HerdrConnectionId,
  MachineId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from '@crook/domain/Ids'
import { Machine } from '@crook/domain/Machine'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { Pane } from '@crook/domain/Pane'
import { Checkout, Place } from '@crook/domain/Place'
import { Tab } from '@crook/domain/Tab'
import { Workspace } from '@crook/domain/Workspace'
import { agentInfo } from '@crook/herdr/RecordFixtures'

import { agentRow } from './Fixtures'

const INITIAL_WINDOW_BYTES = 14_600
const AGENTS_ON_ONE_MACHINE = 10
const STATUSES: readonly AgentStatus[] = ['working', 'idle', 'done', 'blocked']
const WORKSPACE = WorkspaceId.make('w1')
const VERSION = CrookVersion.make('0.0.1')

const observedAt = DateTime.makeUnsafe('2026-10-21T12:00:00Z')

const fixtureCounter = agentInfo().state_change_seq

const widestRandomConnection = HerdrConnectionId.make(Number.MIN_SAFE_INTEGER)

const encodeUpdate = Schema.encodeSync(Schema.toCodecJson(HerdUpdate))

const tabOf = (agent: number) => TabId.make(`w1:t${agent + 1}`)

const laneRow = (agent: number) =>
  agentRow({
    pane: PaneId.make(`w1:p${agent * 2 + 1}`),
    tab: tabOf(agent),
    terminal: TerminalId.make(`term_65e4981ac9ff${agent}`),
    status: Arr.getUnsafe(STATUSES, agent % STATUSES.length),
    title: `JC-${100 + agent} Wire the herd Live Activity and lock-screen approvals`,
    label: Option.some(`Payments ${agent}`),
    createdByCrook: true,
    cwd: `/home/jliocsar/Projects/crook-worktrees/lane-${agent}`,
    branch: Option.some(`feat/jc-${100 + agent}-herd-live-activity`),
    claudeSession: Option.some(ClaudeSessionId.make('cc70b540-d22a-4ea4-aaf9-a0db3ce151aa')),
    stateChangeSeq: fixtureCounter,
  })

const panesBeside = (agent: number) =>
  [agent * 2 + 1, agent * 2 + 2].map(
    (pane) => new Pane({ id: PaneId.make(`w1:p${pane}`), workspace: WORKSPACE, tab: tabOf(agent) }),
  )

const stateWith = (machine: MachineId, agentCount: number) => {
  const agents = Arr.makeBy(agentCount, (agent) => agent)

  return new MachineState({
    machine,
    version: MachineStateVersion.make(fixtureCounter),
    herdrVersion: '0.9.1',
    herdr: new HerdrLink({ connection: widestRandomConnection, lostAt: Option.none() }),
    workspaces: [new Workspace({ id: WORKSPACE, label: 'crook' })],
    tabs: agents.map(
      (agent) => new Tab({ id: tabOf(agent), workspace: WORKSPACE, label: 'claude' }),
    ),
    panes: agents.flatMap(panesBeside),
    agents: agents.map(laneRow),
    places: Arr.makeBy(
      RECENT_PLACES_CAPACITY,
      (place) =>
        new Place({
          folder: `/home/jliocsar/Projects/crook-worktrees/lane-${place}`,
          checkout: Option.some(
            new Checkout({ branch: Option.some(`feat/jc-${100 + place}-herd-live-activity`) }),
          ),
          usedAt: observedAt,
        }),
    ),
  })
}

const machineWith = (machine: MachineId, agentCount: number) =>
  new HerdMachine({
    machine: new Machine({
      id: machine,
      label: machine,
      connection: 'online',
      connectionChangedAt: observedAt,
      lastSeenAt: observedAt,
      agentVersion: Option.some(VERSION),
      herdrVersion: Option.some('0.9.1'),
    }),
    state: Option.some(stateWith(machine, agentCount)),
    seen: [],
    pinned: [],
  })

const herdOf = (machineCount: number) =>
  new HerdView({
    hubVersion: VERSION,
    machines: Arr.makeBy(machineCount, (machine) =>
      machineWith(MachineId.make(`vm-${machine + 1}`), AGENTS_ON_ONE_MACHINE),
    ),
  })

const wireBytes = (update: HerdUpdate) =>
  new TextEncoder().encode(
    String(
      RpcSerialization.ndjson.makeUnsafe().encode({
        _tag: 'Chunk',
        requestId: '1',
        values: [encodeUpdate(update)],
      }),
    ),
  ).length

describe('herd updates on the wire', () => {
  it('carries a change on one machine of ten agents in one initial TCP window', () => {
    expect(
      wireBytes(
        new MachineReplaced({
          entry: machineWith(MachineId.make('laptop'), AGENTS_ON_ONE_MACHINE),
        }),
      ),
    ).toBeLessThan(INITIAL_WINDOW_BYTES)
  })

  it('would need more than one initial TCP window for a whole herd of two such machines', () => {
    expect(wireBytes(new HerdReplaced({ herd: herdOf(2) }))).toBeGreaterThan(INITIAL_WINDOW_BYTES)
  })
})
