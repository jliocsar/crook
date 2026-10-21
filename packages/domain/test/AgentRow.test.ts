import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import { AgentRow, agentTitleOrPane } from '@crook/domain/AgentRow'
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
