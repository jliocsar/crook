import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import { AgentRow } from '@crook/domain/AgentRow'
import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdMachine, HerdView, mostRecentPlace } from '@crook/domain/HerdView'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  ClaudeSessionId,
  GlobalPaneId,
  HerdrConnectionId,
  MachineId,
  PaneId,
  TabId,
  TerminalId,
  toGlobalPaneId,
  WorkspaceId,
} from '@crook/domain/Ids'
import { Machine } from '@crook/domain/Machine'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { Pane } from '@crook/domain/Pane'
import { Place } from '@crook/domain/Place'
import { Tab } from '@crook/domain/Tab'
import { Workspace } from '@crook/domain/Workspace'

const laptop = MachineId.make('laptop')
const workspace = WorkspaceId.make('w1')
const tab = TabId.make('w1:t1')
const observedAt = DateTime.makeUnsafe('2026-10-17T14:00:00.000Z')

const agentRow = (pane: string, claudeSession: Option.Option<ClaudeSessionId>) =>
  new AgentRow({
    pane: PaneId.make(pane),
    workspace,
    tab,
    terminal: TerminalId.make(`term_${pane}`),
    status: 'blocked',
    title: 'EX-253 Example feature',
    label: Option.none(),
    createdByCrook: false,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.some('feat/jc-97-98-registry-seen'),
    claudeSession,
    stateChangeSeq: 7,
    statusChangedAt: observedAt,
    beforeHandoff: Option.none(),
  })

const herd = new HerdView({
  hubVersion: CrookVersion.make('0.1.0'),
  machines: [
    new HerdMachine({
      machine: new Machine({
        id: laptop,
        label: 'laptop',
        connection: 'online',
        connectionChangedAt: observedAt,
        lastSeenAt: observedAt,
        agentVersion: Option.some(CrookVersion.make('0.0.9')),
        herdrVersion: Option.some('0.9.1'),
      }),
      seen: [PaneId.make('w1:p2')],
      pinned: [PaneId.make('w1:p1')],
      state: Option.some(
        new MachineState({
          machine: laptop,
          version: MachineStateVersion.make(3),
          herdrVersion: '0.9.1',
          herdr: new HerdrLink({
            connection: HerdrConnectionId.make(1),
            lostAt: Option.some(observedAt),
          }),
          workspaces: [new Workspace({ id: workspace, label: 'crook' })],
          tabs: [new Tab({ id: tab, workspace, label: 'main' })],
          panes: [
            new Pane({ id: PaneId.make('w1:p1'), workspace, tab }),
            new Pane({ id: PaneId.make('w1:p2'), workspace, tab }),
          ],
          agents: [
            agentRow('w1:p1', Option.some(ClaudeSessionId.make('session-1'))),
            agentRow('w1:p2', Option.none()),
          ],
          places: [],
        }),
      ),
    }),
    new HerdMachine({
      machine: new Machine({
        id: MachineId.make('work-vm'),
        label: 'work-vm',
        connection: 'offline',
        connectionChangedAt: observedAt,
        lastSeenAt: observedAt,
        agentVersion: Option.none(),
        herdrVersion: Option.none(),
      }),
      state: Option.none(),
      seen: [],
      pinned: [],
    }),
  ],
})

describe('HerdView', () => {
  it('survives a round trip through JSON text', () => {
    const wire = JSON.stringify(Schema.encodeSync(HerdView)(herd))

    expect(Schema.decodeSync(Schema.fromJsonString(HerdView))(wire)).toEqual(herd)
  })

  it('encodes absent options and timestamps as JSON-safe values', () => {
    const encoded = Schema.encodeSync(HerdView)(herd)

    expect(encoded.machines[1]?.state).toBeNull()
    expect(encoded.machines[1]?.machine.agentVersion).toBeNull()
    expect(encoded.machines[0]?.machine.lastSeenAt).toBe('2026-10-17T14:00:00.000Z')
  })
})

describe('mostRecentPlace', () => {
  const placeAt = (folder: string, usedAt: string) =>
    new Place({ folder, branch: Option.none(), usedAt: DateTime.makeUnsafe(usedAt) })

  const machineWith = (id: MachineId, connection: 'online' | 'offline', places: readonly Place[]) =>
    new HerdMachine({
      machine: new Machine({
        id,
        label: id,
        connection,
        connectionChangedAt: observedAt,
        lastSeenAt: observedAt,
        agentVersion: Option.none(),
        herdrVersion: Option.none(),
      }),
      state: Option.some(
        new MachineState({
          machine: id,
          version: MachineStateVersion.make(1),
          herdrVersion: '0.9.5',
          herdr: new HerdrLink({ connection: HerdrConnectionId.make(1), lostAt: Option.none() }),
          workspaces: [],
          tabs: [],
          panes: [],
          agents: [],
          places,
        }),
      ),
      seen: [],
      pinned: [],
    })

  it('picks the folder used last on a machine that is online', () => {
    const latest = placeAt('/home/jliocsar/Projects/crook', '2026-10-21T13:00:00Z')
    const offlineLatest = placeAt('/home/jliocsar/.dotfiles', '2026-10-21T14:00:00Z')
    const view = new HerdView({
      hubVersion: CrookVersion.make('0.1.0'),
      machines: [
        machineWith(laptop, 'online', [placeAt('/home/jliocsar/scratch', '2026-10-20T13:00:00Z')]),
        machineWith(MachineId.make('desktop'), 'online', [latest]),
        machineWith(MachineId.make('work-vm'), 'offline', [offlineLatest]),
      ],
    })

    expect(mostRecentPlace(view)).toEqual(
      Option.some({ machine: MachineId.make('desktop'), place: latest }),
    )
  })

  it('has no default when no online machine reported a folder', () => {
    expect(mostRecentPlace(herd)).toEqual(Option.none())
  })
})

describe('GlobalPaneId', () => {
  it('joins the machine and the herdr pane id', () => {
    expect(toGlobalPaneId(laptop, PaneId.make('w1:p1'))).toBe('laptop/w1:p1')
  })

  it('rejects an id without a machine part', () => {
    expect(Result.isFailure(Schema.decodeResult(GlobalPaneId)('w1:p1'))).toBe(true)
  })
})
