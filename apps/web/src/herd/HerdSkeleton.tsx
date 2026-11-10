import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import { constVoid } from 'effect/Function'
import * as Option from 'effect/Option'
import * as React from 'react'

import { AgentRow } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { MachineId, PaneId, TabId, TerminalId, WorkspaceId } from '@crook/domain/Ids'
import { Machine } from '@crook/domain/Machine'
import { MeasuredSkeleton } from '@crook/web/components/MeasuredSkeleton'
import { SectionBody } from '@crook/web/herd/HerdLayout'
import type { AgentCardModel, HerdLayout, MachineSectionModel } from '@crook/web/herd/HerdLayout'
import { HerdList } from '@crook/web/herd/HerdList'
import { FrozenScope } from '@crook/web/navigation/Covered'

const SAMPLE_WORKSPACE = WorkspaceId.make('sample-workspace')
const SAMPLE_TAB = TabId.make('sample-tab')
const SAMPLE_STATUS_AGE = Duration.minutes(5)

const sampleCard = (
  now: DateTime.Utc,
  pane: string,
  status: AgentStatus,
  title: string,
  branch: string,
): AgentCardModel => ({
  row: new AgentRow({
    pane: PaneId.make(pane),
    workspace: SAMPLE_WORKSPACE,
    tab: SAMPLE_TAB,
    terminal: TerminalId.make(pane),
    status,
    title,
    label: Option.none(),
    createdByCrook: false,
    cwd: '/',
    branch: Option.some(branch),
    claudeSession: Option.none(),
    stateChangeSeq: 0,
    statusChangedAt: DateTime.subtractDuration(now, SAMPLE_STATUS_AGE),
    beforeHandoff: Option.none(),
    ask: Option.none(),
    runningSubagents: Option.none(),
    claudeWaiting: Option.none(),
  }),
  needsYou: false,
  pinned: false,
  workspace: 'project',
  tab: 'folder',
  askSummary: Option.none(),
  herdrLostAt: Option.none(),
})

const sampleSection = (
  now: DateTime.Utc,
  id: string,
  label: string,
  agents: readonly AgentCardModel[],
): MachineSectionModel => ({
  machine: new Machine({
    id: MachineId.make(id),
    label,
    connection: 'online',
    connectionChangedAt: now,
    lastSeenAt: now,
    agentVersion: Option.none(),
    herdrVersion: Option.none(),
  }),
  needsYou: 0,
  herdrLostAt: Option.none(),
  body: SectionBody.Agents({ agents }),
})

const sampleHerd = (now: DateTime.Utc): HerdLayout => ({
  notice: Option.none(),
  sections: [
    sampleSection(now, 'sample-one', 'machine', [
      sampleCard(now, 'sample-1', 'working', 'Tidy the settings screen', 'feat/settings'),
      sampleCard(now, 'sample-2', 'done', 'Write the migration notes', 'docs/migration'),
      sampleCard(now, 'sample-3', 'idle', 'Check the release build', 'fix/release'),
    ]),
    sampleSection(now, 'sample-two', 'other', [
      sampleCard(now, 'sample-4', 'working', 'Run the nightly build', 'main'),
      sampleCard(now, 'sample-5', 'idle', 'Clean up old branches', 'main'),
    ]),
  ],
})

const alwaysOpen = () => true

export function HerdSkeleton({ label }: { label: string }) {
  const [layout] = React.useState(() => sampleHerd(DateTime.nowUnsafe()))

  return (
    <MeasuredSkeleton slot="herd-skeleton" label={label}>
      <FrozenScope>
        <HerdList
          layout={layout}
          controlsEnabled={false}
          isOpen={alwaysOpen}
          onToggle={constVoid}
          onOpenAgent={constVoid}
          onOpenActions={constVoid}
          onNewAgent={constVoid}
          onAddMachine={constVoid}
        />
      </FrozenScope>
    </MeasuredSkeleton>
  )
}
