import { describe, expect, it } from '@effect/vitest'
import { act, renderHook } from '@testing-library/react'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import { afterEach, beforeEach, vi } from 'vitest'

import { ShellTask } from '@crook/domain/Background'
import { BackgroundChanged } from '@crook/domain/Transcript'
import {
  ImageBlock,
  LocalCommandBlock,
  LocalCommandOutputBlock,
  TextBlock,
} from '@crook/domain/TranscriptMessage'
import { useBackgroundWorkOf } from '@crook/web/chat/BackgroundDock'
import { backgroundJobs } from '@crook/web/chat/BackgroundModel'
import { lastPromptAt, useEpisodeSummary } from '@crook/web/chat/BackgroundSummary'

import { at, sentCommand, sentPrompt, SESSION, user } from '../TranscriptFixtures.ts'

const NOW = DateTime.makeUnsafe('2026-10-30T14:00:00Z')
const SETTLE_SECONDS = 14

const lineOf = (message: ReturnType<typeof user>) => ({ session: SESSION, message })

const endedAgo = (seconds: number) =>
  new ShellTask({
    taskId: 'bdev',
    toolUseId: 'toolu_dev',
    status: 'completed',
    summary: Option.none(),
    stoppedByClaude: false,
    startedAt: Option.some(DateTime.subtract(NOW, { seconds: seconds + 60 })),
    endedAt: Option.some(DateTime.subtract(NOW, { seconds })),
    command: Option.some('bun run build'),
    description: Option.none(),
    checkedAt: [],
    output: [],
    lastOutputAt: Option.none(),
    alive: Option.none(),
  })

const jobsAt = (now: DateTime.Utc) =>
  backgroundJobs({
    background: Option.some(
      new BackgroundChanged({ session: SESSION, tasks: [endedAgo(5)], activity: [] }),
    ),
    runs: [],
    now,
    paneClosed: false,
  })

describe('lastPromptAt', () => {
  it('counts what the user typed, an image or a slash command, and nothing Claude wrote', () => {
    expect(
      lastPromptAt([lineOf(user(0, [new TextBlock({ text: 'go' })], { seconds: 1 }))]),
    ).toEqual(at(1))
    expect(
      lastPromptAt([
        lineOf(user(0, [new ImageBlock({ mediaType: 'image/png', data: '' })], { seconds: 2 })),
      ]),
    ).toEqual(at(2))
    expect(
      lastPromptAt([
        lineOf(user(0, [new LocalCommandBlock({ name: '/compact', args: '' })], { seconds: 3 })),
      ]),
    ).toEqual(at(3))
    expect(
      lastPromptAt([
        lineOf(user(0, [new TextBlock({ text: 'go' })], { seconds: 1 })),
        lineOf(
          user(10, [new TextBlock({ text: 'expanded command' })], { isMeta: true, seconds: 4 }),
        ),
        lineOf(user(20, [new LocalCommandOutputBlock({ text: 'done' })], { seconds: 5 })),
      ]),
    ).toEqual(at(1))
  })

  it('leaves out a prompt no one typed, so it does not end the summary of work the user has not moved on from', () => {
    expect(
      lastPromptAt([
        lineOf(user(0, [new TextBlock({ text: 'go' })], { seconds: 1 })),
        lineOf(sentPrompt(10, 'A made-up reply', { kind: 'plugin', name: 'madeup' }, 2)),
        lineOf(sentCommand(20, '/sweep', 'tick', { kind: 'scheduled' }, 3)),
      ]),
    ).toEqual(at(1))
  })
})

describe('useEpisodeSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW.epochMilliseconds)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('wakes the screen when the settled work is due a summary', () => {
    const { result } = renderHook(() =>
      useEpisodeSummary(
        useBackgroundWorkOf(jobsAt, () => {}),
        [],
      ),
    )

    expect(Option.isNone(result.current)).toBe(true)

    act(() => {
      vi.advanceTimersByTime(SETTLE_SECONDS * 1000)
    })

    expect(Option.isSome(result.current)).toBe(true)
  })
})
