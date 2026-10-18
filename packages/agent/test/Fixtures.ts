import * as Option from 'effect/Option'

import { AgentInfo, SessionSnapshot, TabInfo, WorkspaceInfo } from '@crook/herdr/Records'

export const workspaceInfo = new WorkspaceInfo({
  workspace_id: 'w1',
  number: 1,
  label: 'crook',
  focused: true,
  pane_count: 1,
  tab_count: 1,
  active_tab_id: 'w1:t1',
  agent_status: 'working',
})

export const tabInfo = new TabInfo({
  tab_id: 'w1:t1',
  workspace_id: 'w1',
  number: 1,
  label: '1 · claude',
  focused: true,
  pane_count: 1,
  agent_status: 'working',
})

export const agentInfo = (fields: Partial<ConstructorParameters<typeof AgentInfo>[0]> = {}) =>
  new AgentInfo({
    pane_id: 'w1:p1',
    terminal_id: 'term_1',
    workspace_id: 'w1',
    tab_id: 'w1:t1',
    focused: true,
    revision: 3,
    agent_status: 'working',
    state_change_seq: 14162,
    completion_seq: Option.none(),
    name: Option.none(),
    agent: Option.some('claude'),
    display_agent: Option.some('claude'),
    agent_session: Option.none(),
    title: Option.none(),
    terminal_title: Option.some('◑ EX-253 Example feature'),
    terminal_title_stripped: Option.some('EX-253 Example feature'),
    cwd: Option.some('/home/jliocsar/Projects/crook'),
    foreground_cwd: Option.none(),
    ...fields,
  })

export const sessionSnapshot = (agents: readonly AgentInfo[]) =>
  new SessionSnapshot({
    version: '0.9.1',
    protocol: 22,
    focused_workspace_id: Option.none(),
    focused_tab_id: Option.none(),
    focused_pane_id: Option.none(),
    workspaces: [workspaceInfo],
    tabs: [tabInfo],
    panes: [],
    agents,
  })
