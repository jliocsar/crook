import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import { AgentRow } from '@crook/domain/AgentRow'
import { HerdMachine, HerdView } from '@crook/domain/HerdView'
import {
  ClaudeSessionId,
  GlobalPaneId,
  MachineId,
  PaneId,
  TabId,
  WorkspaceId,
  toGlobalPaneId,
} from '@crook/domain/Ids'
import { Machine } from '@crook/domain/Machine'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
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
    status: 'blocked',
    title: 'EX-253 Example feature',
    cwd: '/home/jliocsar/Projects/crook',
    claudeSession,
    stateChangeSeq: 7,
    statusChangedAt: observedAt,
  })

const herd = new HerdView({
  machines: [
    new HerdMachine({
      machine: new Machine({
        id: laptop,
        label: 'laptop',
        connection: 'online',
        lastSeenAt: observedAt,
      }),
      state: Option.some(
        new MachineState({
          machine: laptop,
          version: MachineStateVersion.make(3),
          workspaces: [new Workspace({ id: workspace, label: 'crook' })],
          tabs: [new Tab({ id: tab, workspace, label: 'main' })],
          agents: [
            agentRow('w1:p1', Option.some(ClaudeSessionId.make('session-1'))),
            agentRow('w1:p2', Option.none()),
          ],
        }),
      ),
    }),
    new HerdMachine({
      machine: new Machine({
        id: MachineId.make('work-vm'),
        label: 'work-vm',
        connection: 'offline',
        lastSeenAt: observedAt,
      }),
      state: Option.none(),
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
    expect(encoded.machines[0]?.machine.lastSeenAt).toBe('2026-10-17T14:00:00.000Z')
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
