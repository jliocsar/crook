import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import {
  type HerdReading,
  initialMachineState,
  nextMachineState,
} from '@crook/agent/MachineStateMapping'
import { AgentRow } from '@crook/domain/AgentRow'
import { ClaudeSessionId, MachineId, PaneId, TabId, WorkspaceId } from '@crook/domain/Ids'

import { agentInfo, paneInfo, tabInfo, workspaceInfo } from './Fixtures'

const MACHINE = MachineId.make('laptop')
const SESSION = ClaudeSessionId.make('cc70b540-d22a-4ea4-aaf9-a0db3ce151aa')
const STARTED = DateTime.makeUnsafe('2026-10-17T10:00:00Z')
const LATER = DateTime.makeUnsafe('2026-10-17T10:05:00Z')
const HERDR_VERSION = '0.9.1'

const reading = (agents: HerdReading['agents'], herdrVersion = HERDR_VERSION): HerdReading => ({
  herdrVersion,
  workspaces: [workspaceInfo],
  tabs: [tabInfo],
  panes: [],
  agents,
})

describe('MachineStateMapping', () => {
  it('maps a herdr reading to version 0, stamping every status with the read time', () => {
    const state = initialMachineState(
      MACHINE,
      reading([
        { info: agentInfo(), claudeSession: Option.some(SESSION), branch: Option.some('main') },
      ]),
      STARTED,
    )

    expect(state.version).toBe(0)
    expect(state.herdrVersion).toBe(HERDR_VERSION)
    expect(state.workspaces.map((workspace) => [workspace.id, workspace.label])).toEqual([
      ['w1', 'crook'],
    ])
    expect(state.tabs.map((tab) => [tab.id, tab.workspace, tab.label])).toEqual([
      ['w1:t1', 'w1', '1 · claude'],
    ])
    expect(state.agents).toEqual([
      new AgentRow({
        pane: PaneId.make('w1:p1'),
        workspace: WorkspaceId.make('w1'),
        tab: TabId.make('w1:t1'),
        status: 'working',
        title: 'EX-253 Example feature',
        cwd: '/home/jliocsar/Projects/crook',
        branch: Option.some('main'),
        claudeSession: Option.some(SESSION),
        stateChangeSeq: 14162,
        statusChangedAt: STARTED,
      }),
    ])
  })

  it('prefers the foreground cwd and falls back through the title fields', () => {
    const state = initialMachineState(
      MACHINE,
      reading([
        {
          info: agentInfo({
            terminal_title_stripped: Option.none(),
            name: Option.some('reviewer'),
            foreground_cwd: Option.some('/home/jliocsar/Projects/crook/packages/agent'),
          }),
          claudeSession: Option.none(),
          branch: Option.none(),
        },
      ]),
      STARTED,
    )
    const [row] = state.agents

    expect(row?.title).toBe('reviewer')
    expect(row?.cwd).toBe('/home/jliocsar/Projects/crook/packages/agent')
  })

  it('carries the name the pane was given in herdr, and none for an empty or absent one', () => {
    const agents = [
      { info: agentInfo(), claudeSession: Option.none(), branch: Option.none() },
      {
        info: agentInfo({ pane_id: 'w1:p2' }),
        claudeSession: Option.none(),
        branch: Option.none(),
      },
      {
        info: agentInfo({ pane_id: 'w1:p3' }),
        claudeSession: Option.none(),
        branch: Option.none(),
      },
    ]
    const state = initialMachineState(
      MACHINE,
      {
        ...reading(agents),
        panes: [
          paneInfo({ label: Option.some('Payments') }),
          paneInfo({ pane_id: 'w1:p2', label: Option.some('') }),
        ],
      },
      STARTED,
    )

    expect(state.agents.map((row) => [row.title, row.label])).toEqual([
      ['EX-253 Example feature', Option.some('Payments')],
      ['EX-253 Example feature', Option.none()],
      ['EX-253 Example feature', Option.none()],
    ])
  })

  it('keeps the version when a re-read changes nothing', () => {
    const agents = [{ info: agentInfo(), claudeSession: Option.none(), branch: Option.none() }]
    const previous = initialMachineState(MACHINE, reading(agents), STARTED)

    expect(nextMachineState(previous, reading(agents), LATER)).toEqual(Option.none())
  })

  it('bumps the version and restamps only the agent whose status moved', () => {
    const previous = initialMachineState(
      MACHINE,
      reading([
        { info: agentInfo(), claudeSession: Option.none(), branch: Option.none() },
        {
          info: agentInfo({ pane_id: 'w1:p2' }),
          claudeSession: Option.none(),
          branch: Option.none(),
        },
      ]),
      STARTED,
    )
    const next = Option.getOrThrow(
      nextMachineState(
        previous,
        reading([
          {
            info: agentInfo({ agent_status: 'blocked' }),
            claudeSession: Option.none(),
            branch: Option.none(),
          },
          {
            info: agentInfo({ pane_id: 'w1:p2' }),
            claudeSession: Option.none(),
            branch: Option.none(),
          },
        ]),
        LATER,
      ),
    )

    expect(next.version).toBe(1)
    expect(next.agents.map((row) => [row.status, row.statusChangedAt])).toEqual([
      ['blocked', LATER],
      ['working', STARTED],
    ])
  })

  it('bumps the version on a title change without restamping the status', () => {
    const previous = initialMachineState(
      MACHINE,
      reading([{ info: agentInfo(), claudeSession: Option.none(), branch: Option.none() }]),
      STARTED,
    )
    const next = Option.getOrThrow(
      nextMachineState(
        previous,
        reading([
          {
            info: agentInfo({ terminal_title_stripped: Option.some('MEM-690 mobile cut') }),
            claudeSession: Option.none(),
            branch: Option.none(),
          },
        ]),
        LATER,
      ),
    )

    expect(next.version).toBe(1)
    expect(next.agents.map((row) => row.statusChangedAt)).toEqual([STARTED])
  })

  it('bumps the version when herdr itself is updated under a running agent', () => {
    const agents = [{ info: agentInfo(), claudeSession: Option.none(), branch: Option.none() }]
    const previous = initialMachineState(MACHINE, reading(agents), STARTED)
    const next = Option.getOrThrow(nextMachineState(previous, reading(agents, '0.9.5'), LATER))

    expect(next.version).toBe(1)
    expect(next.herdrVersion).toBe('0.9.5')
  })
})
