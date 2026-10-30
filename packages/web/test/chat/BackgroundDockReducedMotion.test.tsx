import { describe, expect, it } from '@effect/vitest'
import { render, screen } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { afterEach, beforeEach, vi } from 'vitest'

import { ShellTask } from '@crook/domain/Background'
import { BackgroundChanged } from '@crook/domain/Transcript'
import { BackgroundDock } from '@crook/web/chat/BackgroundDock'
import { backgroundJobs } from '@crook/web/chat/BackgroundModel'

import { stubMediaQueries } from '../MediaQueries.ts'
import { SESSION } from '../TranscriptFixtures.ts'

const NOW = DateTime.nowUnsafe()

const shell = (key: string) =>
  new ShellTask({
    taskId: `b${key}`,
    toolUseId: `toolu_${key}`,
    status: 'running',
    summary: Option.none(),
    stoppedByClaude: false,
    startedAt: Option.some(DateTime.subtract(NOW, { seconds: 10 })),
    endedAt: Option.none(),
    command: Option.some(`bun run ${key}`),
    description: Option.none(),
    checkedAt: [],
    output: [],
    lastOutputAt: Option.none(),
    alive: Option.some(true),
  })

const jobsAt = (tasks: BackgroundChanged['tasks']) => (now: DateTime.Utc) =>
  backgroundJobs({
    background: Option.some(new BackgroundChanged({ session: SESSION, tasks, activity: [] })),
    runs: [],
    now,
  })

beforeEach(() => {
  stubMediaQueries(['(prefers-reduced-motion)'])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BackgroundDock under reduced motion', () => {
  it.effect('adds a chip at its full size, with no pop', () =>
    Effect.gen(function* () {
      const { rerender } = render(
        <BackgroundDock jobsAt={jobsAt([shell('dev')])} onOpenSubagent={() => {}} />,
      )

      rerender(
        <BackgroundDock
          jobsAt={jobsAt([shell('dev'), shell('storybook')])}
          onOpenSubagent={() => {}}
        />,
      )

      const added = screen.getByRole('button', { name: 'bun run storybook, running' })

      expect(added.style.transform).not.toContain('scale(0.85)')
    }),
  )
})
