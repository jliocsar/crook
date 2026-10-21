import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  HerdrConnectionId,
  MachineId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from '@crook/domain/Ids'
import {
  MachineState,
  MachineStateVersion,
  isHerdrLost,
  isResync,
  panePresence,
} from '@crook/domain/MachineState'
import { Pane } from '@crook/domain/Pane'

const workspace = WorkspaceId.make('w1')
const tab = TabId.make('w1:t1')
const claudePane = PaneId.make('w1:p6')
const shellPane = PaneId.make('w1:p1')
const closedPane = PaneId.make('w1:p5')
const observedAt = DateTime.makeUnsafe('2026-10-20T18:07:41.971Z')

const linkOn = (connection: number, lostAt: Option.Option<DateTime.Utc> = Option.none()) =>
  new HerdrLink({ connection: HerdrConnectionId.make(connection), lostAt })

const stateOn = (herdr: HerdrLink, status: AgentStatus = 'unknown') =>
  new MachineState({
    machine: MachineId.make('laptop'),
    version: MachineStateVersion.make(4),
    herdrVersion: '0.9.5',
    herdr,
    workspaces: [],
    tabs: [],
    panes: [
      new Pane({ id: shellPane, workspace, tab }),
      new Pane({ id: claudePane, workspace, tab }),
    ],
    agents: [
      new AgentRow({
        pane: claudePane,
        workspace,
        tab,
        terminal: TerminalId.make('term_65e4981ac9ff02'),
        status,
        title: 'Claude Code',
        label: Option.none(),
        createdByCrook: false,
        cwd: '/home/jliocsar/Projects/crook',
        branch: Option.none(),
        claudeSession: Option.none(),
        stateChangeSeq: 0,
        statusChangedAt: observedAt,
        beforeHandoff: Option.none(),
        ask: Option.none(),
      }),
    ],
  })

describe('panePresence', () => {
  const state = stateOn(linkOn(1))

  it('tells a pane hosting an agent from one whose agent exited and one that closed', () => {
    expect(panePresence(state, claudePane)).toBe('agent')
    expect(panePresence(state, shellPane)).toBe('noAgent')
    expect(panePresence(state, closedPane)).toBe('gone')
  })
})

describe('isResync', () => {
  it('holds when the agent read the state over a new herdr connection', () => {
    expect(isResync(stateOn(linkOn(1)), stateOn(linkOn(2)))).toBe(true)
  })

  it('does not hold for two reads over the same connection', () => {
    expect(isResync(stateOn(linkOn(1)), stateOn(linkOn(1, Option.some(observedAt))))).toBe(false)
  })
})

describe('MachineState', () => {
  it('marks a state whose herdr connection was lost, and carries it over the wire', () => {
    const lost = stateOn(linkOn(1, Option.some(observedAt)))
    const wire = Schema.decodeSync(Schema.fromJsonString(MachineState))(
      JSON.stringify(Schema.encodeSync(MachineState)(lost)),
    )

    expect(isHerdrLost(lost)).toBe(true)
    expect(isHerdrLost(stateOn(linkOn(1)))).toBe(false)
    expect(wire).toEqual(lost)
  })
})
