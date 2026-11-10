import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as HashMap from 'effect/HashMap'
import * as Option from 'effect/Option'

import { SkillListing } from '@crook/domain/Skill'
import { SubagentActivity } from '@crook/domain/Background'
import { TranscriptOffset } from '@crook/domain/Ids'
import {
  BackgroundChanged,
  omittedBetween,
  omittedUpTo,
  SkillsChanged,
  SubagentsChanged,
} from '@crook/domain/Transcript'
import { OmittedLines } from '@crook/domain/TranscriptMessage'
import type { TranscriptEvent } from '@crook/domain/Transcript'
import {
  applyTranscriptEvent,
  EMPTY_TRANSCRIPT,
  type TranscriptLine,
  withOneHole,
} from '@crook/web/chat/TranscriptState'

import {
  chunk,
  NEXT_SESSION,
  opened,
  prompt,
  REVIEWER,
  said,
  SESSION,
  subagent,
} from '../TranscriptFixtures.ts'

const fold = (events: readonly TranscriptEvent[]) =>
  Arr.reduce(events, EMPTY_TRANSCRIPT, applyTranscriptEvent)

const offsets = (lines: readonly TranscriptLine[]) =>
  Arr.map(
    lines,
    ({ session, message }) => `${session === SESSION ? 'old' : 'new'} ${message.offset}`,
  )

describe('withOneHole', () => {
  const gap = (from: number, start: number, text: string) => [
    omittedBetween(SESSION, TranscriptOffset.make(from), TranscriptOffset.make(start)),
    chunk(start, start + 10, [said(start, text)]),
  ]

  const crossed = (...gaps: readonly (readonly TranscriptEvent[])[]) =>
    fold([opened(), chunk(0, 10, [prompt(0, 'First')]), ...gaps.flat()])

  it('hands back a view with no hole, or one, as it is', () => {
    const none = crossed()
    const one = crossed(gap(10, 100, 'Second'))

    expect(withOneHole(none)).toBe(none)
    expect(withOneHole(one)).toBe(one)
  })

  it('folds all above the hole before the newest into one row at the start of the file', () => {
    const held = crossed(gap(10, 100, 'Second'), gap(110, 200, 'Third'))
    const opening = withOneHole(held)

    expect(Arr.map(opening.lines, ({ message }) => message)).toEqual([
      new OmittedLines({ offset: TranscriptOffset.make(0), byteLength: 100 }),
      said(100, 'Second'),
      new OmittedLines({ offset: TranscriptOffset.make(110), byteLength: 90 }),
      said(200, 'Third'),
    ])
    expect(opening.position).toEqual(held.position)
    expect(opening.rosters).toBe(held.rosters)
  })

  it('leaves no hole behind once the pane opens another session', () => {
    const held = crossed(gap(10, 100, 'Second'))
    const next = applyTranscriptEvent(held, opened(NEXT_SESSION))

    expect(next.lines).toEqual([])
  })

  it("does not take a cold open's row at the start of the file for a hole", () => {
    const cold = fold([
      opened(),
      omittedUpTo(SESSION, TranscriptOffset.make(90)),
      chunk(90, 100, [said(90, 'Tail')]),
      ...gap(100, 190, 'Later'),
    ])

    expect(withOneHole(cold)).toBe(cold)
  })
})

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

  it('starts over on another session, keeping neither its lines nor its roster', () => {
    const view = fold([
      opened(),
      new SubagentsChanged({ session: SESSION, subagents: [subagent({ toolUseId: 'toolu_1' })] }),
      chunk(0, 10, [prompt(0, 'hi')]),
      opened(NEXT_SESSION),
      chunk(0, 5, [prompt(0, 'again')], NEXT_SESSION),
    ])

    expect(offsets(view.lines)).toEqual(['new 0'])
    expect(HashMap.size(view.rosters)).toBe(0)
    expect(Option.map(view.position, (position) => position.session)).toEqual(
      Option.some(NEXT_SESSION),
    )
  })

  it('does nothing on an open of the session it is already in', () => {
    const before = fold([opened(), chunk(0, 10, [prompt(0, 'hi')])])
    const after = applyTranscriptEvent(before, opened())

    expect(offsets(after.lines)).toEqual(['old 0'])
    expect(after.position).toEqual(before.position)
  })

  it('shows a session it went back to once, from where the file is read again', () => {
    const view = fold([
      opened(),
      chunk(0, 10, [prompt(0, 'first')]),
      opened(NEXT_SESSION),
      chunk(0, 5, [prompt(0, 'second')], NEXT_SESSION),
      opened(),
      chunk(0, 10, [prompt(0, 'first')]),
    ])

    expect(offsets(view.lines)).toEqual(['old 0'])
    expect(Option.map(view.position, (position) => position.offset)).toEqual(Option.some(10))
  })

  it('drops the background work of the session it left', () => {
    const before = new BackgroundChanged({
      session: SESSION,
      tasks: [],
      activity: [
        new SubagentActivity({
          subagent: REVIEWER,
          tool: Option.some('Read'),
          subject: Option.some('src/Herd.ts'),
          text: Option.none(),
          at: Option.none(),
        }),
      ],
    })
    const latest = new BackgroundChanged({ session: SESSION, tasks: [], activity: [] })
    const view = fold([opened(), before, latest, opened(NEXT_SESSION)])

    expect(HashMap.get(fold([opened(), before, latest]).backgrounds, SESSION)).toEqual(
      Option.some(latest),
    )
    expect(HashMap.size(view.backgrounds)).toBe(0)
    expect(view.lines).toEqual([])
  })

  it('keeps the skills of the pane across /clear until the agent lists new ones', () => {
    const prototype = new SkillListing({
      name: 'prototype',
      description: 'Build several versions of a UI piece',
      argumentHint: Option.none(),
      scope: 'project',
    })
    const listed = fold([opened(), new SkillsChanged({ session: SESSION, skills: [prototype] })])
    const cleared = applyTranscriptEvent(listed, opened(NEXT_SESSION))

    expect(listed.skills).toEqual([prototype])
    expect(cleared.skills).toEqual([prototype])
    expect(
      applyTranscriptEvent(cleared, new SkillsChanged({ session: NEXT_SESSION, skills: [] }))
        .skills,
    ).toEqual([])
  })
})
