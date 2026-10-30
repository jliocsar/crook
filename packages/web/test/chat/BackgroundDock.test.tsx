import { describe, expect, it } from '@effect/vitest'
import { render, screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { vi } from 'vitest'

import { ShellTask, SubagentActivity } from '@crook/domain/Background'
import type { SubagentStatus } from '@crook/domain/Subagent'
import { BackgroundChanged } from '@crook/domain/Transcript'
import { BackgroundDock } from '@crook/web/chat/BackgroundDock'
import { backgroundJobs, type BackgroundJob, type DockRun } from '@crook/web/chat/BackgroundModel'

import { click, eventually, findByRole } from '../Dom.ts'
import { REVIEWER, SESSION } from '../TranscriptFixtures.ts'

const NOW = DateTime.nowUnsafe()

const ago = (seconds: number) => DateTime.subtract(NOW, { seconds })

const devServer = (status: SubagentStatus = 'running') =>
  new ShellTask({
    taskId: 'bdev',
    toolUseId: 'toolu_dev',
    status,
    summary: Option.none(),
    stoppedByClaude: false,
    startedAt: Option.some(ago(70)),
    endedAt: status === 'running' ? Option.none() : Option.some(ago(600)),
    command: Option.some('bun run dev'),
    description: Option.some('Start the dev server'),
    checkedAt: [ago(30)],
    output: ['ready in 876 ms', 'page reload src/chat/Thread.tsx'],
    lastOutputAt: Option.some(ago(2)),
    alive: Option.some(true),
  })

const reviewer: DockRun = {
  toolUseId: 'toolu_agent',
  subagent: Option.some(REVIEWER),
  description: 'Review the herd diff',
  agentType: 'code-reviewer',
  model: Option.none(),
  background: true,
  status: 'running',
  startedAt: Option.some(ago(40)),
  finishedAt: Option.none(),
}

const reading = new SubagentActivity({
  subagent: REVIEWER,
  tool: Option.some('Read'),
  subject: Option.some('src/Herd.ts'),
  text: Option.none(),
  at: Option.some(ago(1)),
})

const jobsAt =
  (tasks: BackgroundChanged['tasks'], runs: readonly DockRun[]) => (now: DateTime.Utc) =>
    backgroundJobs({
      background: Option.some(
        new BackgroundChanged({ session: SESSION, tasks, activity: [reading] }),
      ),
      runs,
      now,
    })

const renderDock = (
  tasks: BackgroundChanged['tasks'],
  runs: readonly DockRun[],
  onOpenSubagent: (job: BackgroundJob) => void = () => {},
) => render(<BackgroundDock jobsAt={jobsAt(tasks, runs)} onOpenSubagent={onOpenSubagent} />)

describe('BackgroundDock', () => {
  it.effect('counts the running work and shows a chip per job with the latest event', () =>
    Effect.gen(function* () {
      renderDock([devServer()], [reviewer])

      expect(screen.getByText('2 running')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'bun run dev, running' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Review the herd diff, running' })).toBeTruthy()
      expect(screen.getByText('Read(src/Herd.ts)')).toBeTruthy()
    }),
  )

  it.effect('opens a row per job, with the shell output tail, when tapped', () =>
    Effect.gen(function* () {
      renderDock([devServer()], [reviewer])

      yield* click(screen.getByRole('button', { name: /2 running/u }))

      yield* eventually(() => {
        expect(screen.getAllByText('page reload src/chat/Thread.tsx').length).toBeGreaterThan(0)
        expect(screen.getByText('bg')).toBeTruthy()
      })
    }),
  )

  it.effect('opens a shell in a sheet with what Claude did with it', () =>
    Effect.gen(function* () {
      renderDock([devServer()], [])

      yield* click(screen.getByRole('button', { name: 'bun run dev, running' }))

      const sheet = yield* findByRole('dialog', 'bun run dev')

      expect(sheet.textContent).toContain('Started it in the background')
      expect(sheet.textContent).toContain('Read its output at')
      expect(sheet.textContent).toContain('ready in 876 ms')
    }),
  )

  it.effect('hands a subagent to the screen that opens its transcript', () =>
    Effect.gen(function* () {
      const opened = vi.fn<(job: BackgroundJob) => void>()

      renderDock([], [reviewer], opened)

      yield* click(screen.getByRole('button', { name: 'Review the herd diff, running' }))

      expect(opened).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog')).toBeNull()
    }),
  )

  it.effect('stays out of the way once everything ended a while ago', () =>
    Effect.gen(function* () {
      const { container } = renderDock([devServer('completed')], [])

      expect(container.querySelector('[data-slot="background-dock"]')).toBeNull()
    }),
  )

  it.effect('pops a chip in from smaller when new work starts', () =>
    Effect.gen(function* () {
      const { rerender } = renderDock([], [reviewer])

      rerender(
        <BackgroundDock jobsAt={jobsAt([devServer()], [reviewer])} onOpenSubagent={() => {}} />,
      )

      const added = screen.getByRole('button', { name: 'bun run dev, running' })

      expect(added.style.transform).toContain('scale(0.85)')
    }),
  )
})
