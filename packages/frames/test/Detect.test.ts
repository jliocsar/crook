import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { detect } from '@crook/frames/Detect'
import type { Finding } from '@crook/frames/Detect'
import { expectationOf, fromTable, inSequence } from '@crook/frames/Expectations'
import {
  ROW_MOVE_PIXELS,
  FrameLog,
  isStarved,
  leastMovedAt,
  liftAt,
  movedAt,
} from '@crook/frames/FrameLog'
import type { RecordedFrame } from '@crook/frames/FrameLog'

import backtrackSmallFixture from './fixtures/backtrack-small.json' with { type: 'json' }
import backtrackFixture from './fixtures/backtrack.json' with { type: 'json' }
import blankFixture from './fixtures/blank.json' with { type: 'json' }
import cleanFixture from './fixtures/clean.json' with { type: 'json' }
import emptyBandFixture from './fixtures/empty-band.json' with { type: 'json' }
import filledBandFixture from './fixtures/filled-band.json' with { type: 'json' }
import fingerDuringLiftFixture from './fixtures/finger-during-lift.json' with { type: 'json' }
import fingerTurnsAroundFixture from './fixtures/finger-turns-around.json' with { type: 'json' }
import flashFixture from './fixtures/flash.json' with { type: 'json' }
import goneInALongFrameFixture from './fixtures/gone-in-a-long-frame.json' with { type: 'json' }
import liftGlideFixture from './fixtures/lift-glide.json' with { type: 'json' }
import liftMeasuredFixture from './fixtures/lift-measured.json' with { type: 'json' }
import overshootCatchUpFixture from './fixtures/overshoot-catch-up.json' with { type: 'json' }
import overshootSendFixture from './fixtures/overshoot-send.json' with { type: 'json' }
import pairFixture from './fixtures/pair.json' with { type: 'json' }
import shiftFixture from './fixtures/shift.json' with { type: 'json' }
import slowFramesHoldFixture from './fixtures/slow-frames-hold.json' with { type: 'json' }
import swapFixture from './fixtures/swap.json' with { type: 'json' }

const decodeLog = Schema.decodeUnknownSync(FrameLog)

const MACHINE_REDIAL = 'transition/machine-redial'

const framesWhereTheLiftRises = (log: FrameLog): readonly RecordedFrame[] =>
  pipe(
    log.frames,
    Arr.drop(1),
    Arr.zip(log.frames),
    Arr.filter(([next, frame]) => liftAt(next) - liftAt(frame) >= ROW_MOVE_PIXELS),
    Arr.map(([next]) => next),
  )

const keysOf = (findings: readonly Finding[]): readonly string[] =>
  Arr.map(findings, (finding) => finding.key)

const findingNamed = (findings: readonly Finding[], key: string): Finding =>
  Option.getOrThrow(Arr.findFirst(findings, (finding) => finding.key === key))

describe('detect, over logs recorded from real runs', () => {
  it('reports a state that showed for fewer frames than a state must hold', () => {
    const story = 'transition/reconnect-chat-open'
    const findings = detect(story, decodeLog(flashFixture), expectationOf(story))
    const flash = findingNamed(findings, 'flash:catching-up')

    expect(keysOf(findings)).toEqual(['flash:catching-up', 'flash:spinner'])
    expect(flash.check).toBe('flash')
    expect(flash.lastFrame - flash.firstFrame + 1).toBeLessThan(24)
    expect(flash.marks).toContain('catching-up')
    expect(flash.words).toContain('"catching-up" showed for only')
  })

  it('does not call the same state a flash once it holds long enough', () => {
    const story = 'transition/reconnect-chat-open'
    const log = decodeLog(flashFixture)
    const lowEnough = detect(story, log, expectationOf(story), 2)

    expect(keysOf(lowEnough)).toEqual([])
  })

  it('passes a state that held 400 ms in fewer frames, because a few frames ran long', () => {
    const story = 'transition/reconnect-chat-open'
    const log = decodeLog(slowFramesHoldFixture)
    const held = log.frames.filter((frame) => frame.marks['catching-up'] !== undefined)

    expect(held.length).toBeLessThan(24)
    expect(keysOf(detect(story, log, expectationOf(story)))).toEqual([])
  })

  it('draws the line at 400 ms for a state under 24 frames, a steady 60 Hz well below it', () => {
    const story = 'transition/reconnect-chat-open'
    const log = decodeLog(flashFixture)
    const keysAtGap = (gapMs: number) =>
      keysOf(
        detect(
          story,
          {
            ...log,
            frames: Arr.map(log.frames, (frame, index) => ({ ...frame, at: index * gapMs })),
          },
          expectationOf(story),
        ),
      )

    expect(keysAtGap(1000 / 60)).toContain('flash:catching-up')
    expect(keysAtGap(23)).toContain('flash:catching-up')
    expect(keysAtGap(24)).toEqual([])
  })

  it('reports a state gone within a long frame, however late the next frame came', () => {
    const story = 'actions/toast-after-chat-close'
    const findings = detect(story, decodeLog(goneInALongFrameFixture), expectationOf(story))
    const flash = findingNamed(findings, 'flash:spinner')

    expect(flash.toMs - flash.fromMs).toBeGreaterThan(400)
    expect(flash.words).toContain('only 6 frames over 101 ms')
  })

  it('does not take the clock of a starved run, where a real flash reads as a long hold', () => {
    const story = 'transition/reconnect-chat-open'
    const log = decodeLog(flashFixture)
    const stretched = {
      ...log,
      frames: Arr.map(log.frames, (frame) => ({ ...frame, at: frame.at * 2 })),
      steps: Arr.map(log.steps, (step) => ({ ...step, at: step.at * 2 })),
    }
    const flash = findingNamed(detect(story, stretched, expectationOf(story)), 'flash:catching-up')

    expect(isStarved(stretched.frames)).toBe(true)
    expect(flash.lastFrame - flash.firstFrame + 1).toBeLessThan(24)
    expect(flash.words).toContain('This run was starved')
  })

  it('reports a blank frame between the first frame and the first state', () => {
    const story = 'transition/herd-first-link-value'
    const findings = detect(story, decodeLog(blankFixture), expectationOf(story))
    const blank = findingNamed(findings, 'blank')

    expect(keysOf(findings)).toEqual(['blank'])
    expect(blank.check).toBe('blank')
    expect(blank.words).toContain('herd-skeleton')
    expect(blank.words).toContain('the first frame')
  })

  it('reports a row that moved up a frame before the lift caught it and back down after', () => {
    const story = 'transition/slash-send-following'
    const findings = detect(story, decodeLog(backtrackFixture), expectationOf(story))
    const backtrack = findingNamed(findings, 'backtrack')

    expect(keysOf(findings)).toEqual(['backtrack'])
    expect(backtrack.check).toBe('backtrack')
    expect(backtrack.firstFrame).toBe(142)
    expect(backtrack.lastFrame).toBe(143)
    expect(backtrack.words).toContain('moved up 37 px')
    expect(backtrack.words).toContain('back down 37 px')
  })

  it('reports the same backtrack when only the last few pixels of a lift came late', () => {
    const story = 'transition/slash-send-following-one-write'
    const findings = detect(story, decodeLog(backtrackSmallFixture), expectationOf(story))

    expect(keysOf(findings)).toEqual(['backtrack'])
    expect(findingNamed(findings, 'backtrack').words).toContain('moved up 5 px')
  })

  it('reports no backtrack over a lift that starts in its commit and glides up', () => {
    const story = 'transition/slash-send-following'
    const log = decodeLog(liftGlideFixture)

    expect(Arr.some(log.frames, (frame) => movedAt(frame) <= -ROW_MOVE_PIXELS)).toBe(true)
    expect(keysOf(detect(story, log, expectationOf(story)))).toEqual([])
  })

  it('reports no backtrack where a finger turns around, though the row does move both ways', () => {
    const story = 'transition/slash-send-following'
    const log = decodeLog(fingerTurnsAroundFixture)
    const turnsAround = pipe(
      log.frames,
      Arr.drop(1),
      Arr.zip(log.frames),
      Arr.some(
        ([next, frame]) => movedAt(frame) <= -ROW_MOVE_PIXELS && movedAt(next) >= ROW_MOVE_PIXELS,
      ),
    )

    expect(turnsAround).toBe(true)
    expect(keysOf(detect(story, log, expectationOf(story)))).not.toContain('backtrack')
  })

  it('reports a lift that took a row at its estimate, in the frame it rose', () => {
    const story = 'transition/slash-send-following'
    const findings = detect(story, decodeLog(overshootSendFixture), expectationOf(story))
    const overshoot = findingNamed(findings, 'overshoot')

    expect(keysOf(findings)).toEqual(['overshoot'])
    expect(overshoot.check).toBe('overshoot')
    expect(overshoot.firstFrame).toBe(overshoot.lastFrame)
    expect(overshoot.words).toContain('at least 12 px')
    expect(overshoot.words).toContain('from 0 to 96 px')
  })

  it('reports a catch-up that lifted rows estimated past the screen, though they fit it', () => {
    const story = 'transition/reopen-over-big-gap'
    const findings = detect(story, decodeLog(overshootCatchUpFixture), expectationOf(story))

    expect(keysOf(findings)).toEqual(['overshoot'])
    expect(findingNamed(findings, 'overshoot').words).toContain('at least 98 px')
  })

  it('reports no overshoot over a lift that takes what the row measured', () => {
    const story = 'transition/slash-send-following'
    const log = decodeLog(liftMeasuredFixture)

    expect(framesWhereTheLiftRises(log).length).toBeGreaterThan(0)
    expect(keysOf(detect(story, log, expectationOf(story)))).toEqual([])
  })

  it('reports no overshoot where a finger moves every row down as a lift rises', () => {
    const story = 'transition/slash-send-following'
    const log = decodeLog(fingerDuringLiftFixture)

    const movedByTheFinger = Arr.filter(
      framesWhereTheLiftRises(log),
      (frame) => leastMovedAt(frame) >= ROW_MOVE_PIXELS,
    )

    expect(movedByTheFinger.length).toBeGreaterThan(0)
    expect(Arr.every(movedByTheFinger, (frame) => frame.thread?.held === true)).toBe(true)
    expect(keysOf(detect(story, log, expectationOf(story)))).not.toContain('overshoot')
  })

  it('reports a band of the thread with no rows in it during a lift, at its widest frame', () => {
    const story = 'transition/reopen-over-big-gap-long'
    const findings = detect(story, decodeLog(emptyBandFixture), expectationOf(story))
    const top = findingNamed(findings, 'empty:top')

    expect(keysOf(findings)).toEqual(['empty:top', 'empty:middle'])
    expect(top.check).toBe('empty')
    expect(top.firstFrame).toBe(155)
    expect(top.lastFrame).toBe(161)
    expect(top.imageFrame).toBe(155)
    expect(top.words).toContain('as much as 392 px')
    expect(top.words).toContain('the lift at 660 px')
  })

  it('stays quiet about a lift that keeps the screen filled, the same story fixed', () => {
    const story = 'transition/reopen-over-big-gap-long'
    const log = decodeLog(filledBandFixture)

    expect(Math.max(...Arr.map(log.frames, (frame) => frame.thread?.lift ?? 0))).toBe(660)
    expect(detect(story, log, expectationOf(story))).toEqual([])
  })

  it('reports a pair of states the story does not allow side by side', () => {
    const findings = detect(MACHINE_REDIAL, decodeLog(pairFixture), expectationOf(MACHINE_REDIAL))
    const pair = findingNamed(findings, 'pair:composer+edge-card')

    expect(pair.lastFrame - pair.firstFrame + 1).toBe(2)
    expect(pair.marks).toEqual(expect.arrayContaining(['composer', 'edge-card']))
  })

  it('reports layout shift over the budget and names what moved', () => {
    const story = 'transition/clear'
    const findings = detect(story, decodeLog(shiftFixture), expectationOf(story))
    const shift = findingNamed(findings, 'shift:div[chat-dock]')

    expect(keysOf(findings)).toEqual(['shift:div[chat-dock]'])
    expect(shift.words).toContain('above this story')
    expect(shift.words).toContain('div[chat-dock] moved from')
  })

  it('stays quiet about layout shift inside the budget', () => {
    const story = 'transition/clear'
    const roomy = { ...expectationOf(story), shiftBudget: 1 }

    expect(detect(story, decodeLog(shiftFixture), roomy)).toEqual([])
  })

  it('reports a step the allowed sequence does not have, in both directions', () => {
    const findings = detect(MACHINE_REDIAL, decodeLog(swapFixture), expectationOf(MACHINE_REDIAL))

    expect(keysOf(findings)).toEqual([
      'order:dock:composer>edge-card',
      'order:dock:edge-card>composer',
    ])
    expect(findingNamed(findings, 'order:dock:composer>edge-card').words).toBe(
      '"composer" gave way to "edge-card" on the dock track, and this story does not allow that step.',
    )
  })

  it('takes a table where a story declares a sequence, the seam for a machine', () => {
    const machine = fromTable({ composer: ['edge-card'], 'edge-card': ['composer'] })
    const expectation = {
      ...expectationOf(MACHINE_REDIAL),
      order: { dock: machine },
    }

    expect(detect(MACHINE_REDIAL, decodeLog(swapFixture), expectation)).toEqual([])
  })

  it('finds nothing wrong with a clean story', () => {
    const story = 'transition/cold-chat-open'

    expect(detect(story, decodeLog(cleanFixture), expectationOf(story))).toEqual([])
  })

  it('forbids a state the track does not name at all', () => {
    const story = 'transition/cold-chat-open'
    const noSkeleton = {
      ...expectationOf(story),
      order: { thread: inSequence('thread-rows') },
    }

    expect(keysOf(detect(story, decodeLog(cleanFixture), noSkeleton))).toEqual([
      'order:thread:start>thread-skeleton',
      'order:thread:thread-skeleton>thread-rows',
    ])
  })
})
