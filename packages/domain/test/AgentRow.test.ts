import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'

import {
  AgentRow,
  StatusBeforeHandoff,
  agentTitleOrPane,
  settledStatusOf,
} from '@crook/domain/AgentRow'
import { PaneId, TabId, TerminalId, WorkspaceId } from '@crook/domain/Ids'

const rowTitled = (pane: string, title: string, label: Option.Option<string> = Option.none()) =>
  new AgentRow({
    pane: PaneId.make(pane),
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    terminal: TerminalId.make('term_1'),
    status: 'idle',
    title,
    label,
    createdByCrook: false,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq: 0,
    statusChangedAt: DateTime.makeUnsafe(0),
    beforeHandoff: Option.none(),
    ask: Option.none(),
  })

describe('agentTitleOrPane', () => {
  it('titles an agent herdr knows no title for by its pane id', () => {
    expect(agentTitleOrPane(rowTitled('w1:p1', 'Port the herd'))).toBe('Port the herd')
    expect(agentTitleOrPane(rowTitled('w1:p2', ''))).toBe('w1:p2')
  })

  it('titles an agent by the name its pane was given in herdr over its own title', () => {
    expect(agentTitleOrPane(rowTitled('w1:p3', 'Port the herd', Option.some('Payments')))).toBe(
      'Payments',
    )
  })
})

describe('settledStatusOf', () => {
  it('reads the status a handoff carried over before the row own one', () => {
    const settled = rowTitled('w1:p1', 'Port the herd')
    const handedOff = new AgentRow(
      Struct.evolve(settled, {
        status: (): AgentRow['status'] => 'unknown',
        beforeHandoff: () =>
          Option.some(
            new StatusBeforeHandoff({
              status: 'blocked',
              statusChangedAt: DateTime.makeUnsafe(5000),
              terminal: TerminalId.make('term_0'),
              stateChangeSeq: 3,
            }),
          ),
      }),
    )

    expect([settledStatusOf(settled).status, settledStatusOf(settled).statusChangedAt]).toEqual([
      'idle',
      DateTime.makeUnsafe(0),
    ])
    expect([settledStatusOf(handedOff).status, settledStatusOf(handedOff).statusChangedAt]).toEqual(
      ['blocked', DateTime.makeUnsafe(5000)],
    )
  })
})
