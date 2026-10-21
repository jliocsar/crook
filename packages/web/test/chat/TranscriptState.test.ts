import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'

import { SubagentsChanged } from '@crook/domain/Transcript'
import type { TranscriptEvent } from '@crook/domain/Transcript'
import { MachineNotInHerd } from '@crook/protocol/ClientApi'
import { LAPTOP } from '../HerdFixtures.ts'
import {
  applyTranscriptEvent,
  EMPTY_TRANSCRIPT,
  failedWith,
  TranscriptLine,
} from '@crook/web/chat/TranscriptState'

import {
  chunk,
  NEXT_SESSION,
  opened,
  prompt,
  said,
  SESSION,
  subagent,
} from '../TranscriptFixtures.ts'

const fold = (events: readonly TranscriptEvent[]) =>
  Arr.reduce(events, EMPTY_TRANSCRIPT, applyTranscriptEvent)

const offsets = (lines: readonly TranscriptLine[]) =>
  Arr.map(lines, (line) =>
    TranscriptLine.$match(line, {
      Message: ({ session, message }) => `${session === SESSION ? 'old' : 'new'} ${message.offset}`,
      SessionCleared: () => 'cleared',
    }),
  )

describe('applyTranscriptEvent', () => {
  it('starts at the opened session and keeps every chunk in order', () => {
    const view = fold([
      opened(),
      chunk(0, 10, [prompt(0, 'hi')]),
      chunk(10, 20, [said(10, 'hello')]),
    ])

    expect(offsets(view.lines)).toEqual(['old 0', 'old 10'])
    expect(Option.map(view.position, (position) => position.offset)).toEqual(Option.some(20))
  })

  it('drops what a resumed watch sends again and keeps only the lines after the position', () => {
    const view = fold([
      opened(),
      chunk(0, 10, [prompt(0, 'hi')]),
      opened(),
      chunk(0, 20, [prompt(0, 'hi'), said(10, 'hello')]),
      chunk(0, 10, [prompt(0, 'hi')]),
    ])

    expect(offsets(view.lines)).toEqual(['old 0', 'old 10'])
  })

  it('marks a cleared conversation and forgets the subagents of the old session', () => {
    const view = fold([
      opened(),
      new SubagentsChanged({ session: SESSION, subagents: [subagent({ toolUseId: 'toolu_1' })] }),
      chunk(0, 10, [prompt(0, 'hi')]),
      opened(NEXT_SESSION),
      chunk(0, 5, [prompt(0, 'again')], NEXT_SESSION),
    ])

    expect(offsets(view.lines)).toEqual(['old 0', 'cleared', 'new 0'])
    expect(view.subagents).toEqual([])
  })

  it('keeps the roster of the session it is in', () => {
    const roster = [subagent({ toolUseId: 'toolu_1' })]
    const view = fold([
      opened(),
      new SubagentsChanged({ session: SESSION, subagents: roster }),
      new SubagentsChanged({ session: NEXT_SESSION, subagents: [] }),
    ])

    expect(view.subagents).toEqual(roster)
  })

  it('keeps the lines it holds when the watch fails', () => {
    const view = pipe(fold([opened(), chunk(0, 10, [prompt(0, 'hi')])]), (held) =>
      failedWith(held, new MachineNotInHerd({ machine: LAPTOP })),
    )

    expect(offsets(view.lines)).toEqual(['old 0'])
    expect(Option.isSome(view.failure)).toBe(true)
  })

  it('forgets the failure once a watch delivers again', () => {
    const failed = failedWith(
      fold([opened(), chunk(0, 10, [prompt(0, 'hi')])]),
      new MachineNotInHerd({ machine: LAPTOP }),
    )

    expect(applyTranscriptEvent(failed, opened()).failure).toEqual(Option.none())
    expect(applyTranscriptEvent(failed, chunk(10, 20, [said(10, 'back')])).failure).toEqual(
      Option.none(),
    )
  })
})
