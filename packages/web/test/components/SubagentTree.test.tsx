import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SubagentTree } from '@crook/web/components/ui/subagent-tree'
import type { AgentRun, AgentRunStatus } from '@crook/web/components/ui/subagent-tree'

const run = (id: string, status: AgentRunStatus): AgentRun => ({
  id,
  label: id,
  status,
  selectable: false,
})

const tree = (runs: readonly AgentRun[]) =>
  render(<SubagentTree runs={runs} onSelectRun={() => undefined} />).container.textContent

describe('SubagentTree', () => {
  it('accounts for a run the pane cut off beside the done count, not as failed', () => {
    const text = tree([run('a', 'done'), run('b', 'done'), run('c', 'pane closed')])

    expect(text).toContain('2/3 done')
    expect(text).toContain('1 pane closed')
    expect(text).not.toContain('failed')
  })

  it('says nothing of a pane when none closed', () => {
    expect(tree([run('a', 'done'), run('b', 'failed')])).not.toContain('pane closed')
  })
})
