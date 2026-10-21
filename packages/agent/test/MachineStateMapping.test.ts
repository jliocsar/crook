import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import {
  type HerdReading,
  herdrLostState,
  initialMachineState,
  nextMachineState,
} from '@crook/agent/MachineStateMapping'
import { AgentRow, StatusBeforeHandoff } from '@crook/domain/AgentRow'
import {
  ClaudeSessionId,
  HerdrConnectionId,
  MachineId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from '@crook/domain/Ids'
import { panePresence } from '@crook/domain/MachineState'
import type { AgentInfo } from '@crook/herdr/Records'

import { agentInfo, paneInfo, tabInfo, workspaceInfo } from './Fixtures'

const MACHINE = MachineId.make('laptop')
const SESSION = ClaudeSessionId.make('cc70b540-d22a-4ea4-aaf9-a0db3ce151aa')
const SESSION_AFTER_RESTART = ClaudeSessionId.make('5f0c2a8e-91d4-4b6e-a3c7-2e8d6b1f4a90')
const STARTED = DateTime.makeUnsafe('2026-10-17T10:00:00Z')
const LATER = DateTime.makeUnsafe('2026-10-17T10:05:00Z')
const REDETECTED = DateTime.makeUnsafe('2026-10-17T10:05:03Z')
const TERMINAL_BEFORE_HANDOFF = 'term_65e4959ec32112'
const TERMINAL_AFTER_HANDOFF = 'term_65e4981ac9ff02'
const HERDR_VERSION = '0.9.1'
const CONNECTION = HerdrConnectionId.make(1)
const NEXT_CONNECTION = HerdrConnectionId.make(2)

const reading = (agents: HerdReading['agents'], herdrVersion = HERDR_VERSION): HerdReading => ({
  herdrVersion,
  workspaces: [workspaceInfo],
  tabs: [tabInfo],
  panes: agents.map(({ info }) =>
    paneInfo({ pane_id: info.pane_id, terminal_id: info.terminal_id }),
  ),
  agents,
})

const handoffReading = (
  terminal_id: string,
  agent_status: AgentInfo['agent_status'],
  state_change_seq: number,
  claudeSession: Option.Option<ClaudeSessionId> = Option.some(SESSION),
) =>
  reading([
    {
      info: agentInfo({ pane_id: 'w1:p6', terminal_id, agent_status, state_change_seq }),
      claudeSession,
      branch: Option.none(),
    },
  ])

const afterRestart = (claudeSession: Option.Option<ClaudeSessionId>) => {
  const previous = initialMachineState(
    MACHINE,
    CONNECTION,
    handoffReading(TERMINAL_BEFORE_HANDOFF, 'blocked', 5),
    STARTED,
  )
  const restarted = Option.getOrThrow(
    nextMachineState(
      previous,
      NEXT_CONNECTION,
      handoffReading(TERMINAL_AFTER_HANDOFF, 'unknown', 0, claudeSession),
      LATER,
    ),
  )
  const detected = Option.getOrThrow(
    nextMachineState(
      restarted,
      NEXT_CONNECTION,
      handoffReading(TERMINAL_AFTER_HANDOFF, 'blocked', 1, claudeSession),
      REDETECTED,
    ),
  )

  return { restarted, detected }
}

const throughHandoff = (redetectedAs: AgentInfo['agent_status']) => {
  const previous = initialMachineState(
    MACHINE,
    CONNECTION,
    handoffReading(TERMINAL_BEFORE_HANDOFF, 'blocked', 5),
    STARTED,
  )
  const resynced = Option.getOrThrow(
    nextMachineState(
      previous,
      NEXT_CONNECTION,
      handoffReading(TERMINAL_AFTER_HANDOFF, 'unknown', 0),
      LATER,
    ),
  )
  const redetected = Option.getOrThrow(
    nextMachineState(
      resynced,
      NEXT_CONNECTION,
      handoffReading(TERMINAL_AFTER_HANDOFF, redetectedAs, 1),
      REDETECTED,
    ),
  )

  return { previous, resynced, redetected }
}

describe('MachineStateMapping', () => {
  it('maps a herdr reading to version 0, stamping every status with the read time', () => {
    const state = initialMachineState(
      MACHINE,
      CONNECTION,
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
        terminal: TerminalId.make('term_1'),
        status: 'working',
        title: 'EX-253 Example feature',
        cwd: '/home/jliocsar/Projects/crook',
        branch: Option.some('main'),
        claudeSession: Option.some(SESSION),
        stateChangeSeq: 14162,
        statusChangedAt: STARTED,
        beforeHandoff: Option.none(),
      }),
    ])
  })

  it('prefers the foreground cwd and falls back through the title fields', () => {
    const state = initialMachineState(
      MACHINE,
      CONNECTION,
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

  it('keeps the version when a re-read changes nothing', () => {
    const agents = [{ info: agentInfo(), claudeSession: Option.none(), branch: Option.none() }]
    const previous = initialMachineState(MACHINE, CONNECTION, reading(agents), STARTED)

    expect(nextMachineState(previous, CONNECTION, reading(agents), LATER)).toEqual(Option.none())
  })

  it('bumps the version and restamps only the agent whose status moved', () => {
    const previous = initialMachineState(
      MACHINE,
      CONNECTION,
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
        CONNECTION,
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
      CONNECTION,
      reading([{ info: agentInfo(), claudeSession: Option.none(), branch: Option.none() }]),
      STARTED,
    )
    const next = Option.getOrThrow(
      nextMachineState(
        previous,
        CONNECTION,
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
    const previous = initialMachineState(MACHINE, CONNECTION, reading(agents), STARTED)
    const next = Option.getOrThrow(
      nextMachineState(previous, CONNECTION, reading(agents, '0.9.5'), LATER),
    )

    expect(next.version).toBe(1)
    expect(next.herdrVersion).toBe('0.9.5')
  })

  it('lists every pane herdr shows, so a pane whose agent exited stays apart from a closed one', () => {
    const state = initialMachineState(
      MACHINE,
      CONNECTION,
      {
        ...reading([]),
        panes: [paneInfo({ pane_id: 'w1:p1' }), paneInfo({ pane_id: 'w1:p2' })],
      },
      STARTED,
    )

    expect(state.panes.map((pane) => [pane.id, pane.workspace, pane.tab])).toEqual([
      ['w1:p1', 'w1', 'w1:t1'],
      ['w1:p2', 'w1', 'w1:t1'],
    ])
    expect(panePresence(state, PaneId.make('w1:p2'))).toBe('noAgent')
    expect(panePresence(state, PaneId.make('w1:p3'))).toBe('gone')
  })

  it('bumps the version for a re-read over a new herdr connection even when the herd is unchanged', () => {
    const agents = [{ info: agentInfo(), claudeSession: Option.none(), branch: Option.none() }]
    const previous = initialMachineState(MACHINE, CONNECTION, reading(agents), STARTED)
    const next = Option.getOrThrow(
      nextMachineState(previous, NEXT_CONNECTION, reading(agents), LATER),
    )

    expect(next.version).toBe(1)
    expect(next.herdr.connection).toBe(NEXT_CONNECTION)
  })

  it('marks the state lost once, on the same connection, until a read clears it', () => {
    const agents = [{ info: agentInfo(), claudeSession: Option.none(), branch: Option.none() }]
    const previous = initialMachineState(MACHINE, CONNECTION, reading(agents), STARTED)
    const lost = Option.getOrThrow(herdrLostState(previous, LATER))
    const recovered = Option.getOrThrow(
      nextMachineState(lost, NEXT_CONNECTION, reading(agents), LATER),
    )

    expect(lost.version).toBe(1)
    expect(lost.herdr.connection).toBe(CONNECTION)
    expect(lost.herdr.lostAt).toEqual(Option.some(LATER))
    expect(lost.agents).toEqual(previous.agents)
    expect(herdrLostState(lost, LATER)).toEqual(Option.none())
    expect(recovered.version).toBe(2)
    expect(recovered.herdr.lostAt).toEqual(Option.none())
  })

  it('keeps a status herdr re-detects as unknown after a handoff, under the new terminal', () => {
    const before = [
      {
        info: agentInfo({
          pane_id: 'w1:p6',
          terminal_id: 'term_65e4959ec32112',
          agent_status: 'idle',
          state_change_seq: 2,
          completion_seq: Option.some(2),
        }),
        claudeSession: Option.none(),
        branch: Option.none(),
      },
    ]
    const after = [
      {
        info: agentInfo({
          pane_id: 'w1:p6',
          terminal_id: 'term_65e4981ac9ff02',
          agent_status: 'unknown',
          state_change_seq: 0,
        }),
        claudeSession: Option.none(),
        branch: Option.none(),
      },
    ]
    const previous = initialMachineState(MACHINE, CONNECTION, reading(before), STARTED)
    const next = Option.getOrThrow(
      nextMachineState(previous, NEXT_CONNECTION, reading(after), LATER),
    )

    expect(
      next.agents.map((row) => [row.pane, row.terminal, row.status, row.stateChangeSeq]),
    ).toEqual([['w1:p6', TerminalId.make('term_65e4981ac9ff02'), 'unknown', 0]])
    expect(next.agents.map((row) => row.statusChangedAt)).toEqual([LATER])
  })

  it('remembers the status before a handoff while herdr has not re-detected the agent', () => {
    const { resynced } = throughHandoff('blocked')

    expect(
      resynced.agents.map((row) => [row.status, row.statusChangedAt, row.beforeHandoff]),
    ).toEqual([
      [
        'unknown',
        LATER,
        Option.some(new StatusBeforeHandoff({ status: 'blocked', statusChangedAt: STARTED })),
      ],
    ])
  })

  it('keeps the age of a status herdr re-detects unchanged after a handoff', () => {
    const { redetected } = throughHandoff('blocked')

    expect(
      redetected.agents.map((row) => [row.status, row.statusChangedAt, row.beforeHandoff]),
    ).toEqual([['blocked', STARTED, Option.none()]])
  })

  it('stamps a status herdr re-detects differently after a handoff with the re-detection', () => {
    const { redetected } = throughHandoff('done')

    expect(
      redetected.agents.map((row) => [row.status, row.statusChangedAt, row.beforeHandoff]),
    ).toEqual([['done', REDETECTED, Option.none()]])
  })

  it('carries nothing over to a new Claude started in a pane herdr restored after a restart', () => {
    const { restarted, detected } = afterRestart(Option.some(SESSION_AFTER_RESTART))

    expect(
      restarted.agents.map((row) => [row.status, row.statusChangedAt, row.beforeHandoff]),
    ).toEqual([['unknown', LATER, Option.none()]])
    expect(detected.agents.map((row) => [row.status, row.statusChangedAt])).toEqual([
      ['blocked', REDETECTED],
    ])
  })

  it('carries nothing over a new terminal whose Claude session is not resolved', () => {
    const { restarted, detected } = afterRestart(Option.none())

    expect(restarted.agents.map((row) => row.beforeHandoff)).toEqual([Option.none()])
    expect(detected.agents.map((row) => row.statusChangedAt)).toEqual([REDETECTED])
  })

  it('does not invent a status before a handoff for an agent that was unknown already', () => {
    const previous = initialMachineState(
      MACHINE,
      CONNECTION,
      handoffReading(TERMINAL_BEFORE_HANDOFF, 'unknown', 0),
      STARTED,
    )
    const resynced = Option.getOrThrow(
      nextMachineState(
        previous,
        NEXT_CONNECTION,
        handoffReading(TERMINAL_AFTER_HANDOFF, 'unknown', 0),
        LATER,
      ),
    )

    expect(resynced.agents.map((row) => [row.statusChangedAt, row.beforeHandoff])).toEqual([
      [STARTED, Option.none()],
    ])
  })
})
