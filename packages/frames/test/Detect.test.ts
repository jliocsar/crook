import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { detect } from '@crook/frames/Detect'
import type { Finding } from '@crook/frames/Detect'
import { expectationOf, fromTable, inSequence } from '@crook/frames/Expectations'
import { FrameLog, isStarved } from '@crook/frames/FrameLog'

import blankFixture from './fixtures/blank.json' with { type: 'json' }
import cleanFixture from './fixtures/clean.json' with { type: 'json' }
import emptyBandFixture from './fixtures/empty-band.json' with { type: 'json' }
import filledBandFixture from './fixtures/filled-band.json' with { type: 'json' }
import flashFixture from './fixtures/flash.json' with { type: 'json' }
import goneInALongFrameFixture from './fixtures/gone-in-a-long-frame.json' with { type: 'json' }
import pairFixture from './fixtures/pair.json' with { type: 'json' }
import shiftFixture from './fixtures/shift.json' with { type: 'json' }
import slowFramesHoldFixture from './fixtures/slow-frames-hold.json' with { type: 'json' }
import swapFixture from './fixtures/swap.json' with { type: 'json' }

const decodeLog = Schema.decodeUnknownSync(FrameLog)

const MACHINE_REDIAL = 'transition/machine-redial'

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

  it('keeps a state under 24 frames at a steady 60 Hz a flash', () => {
    const story = 'transition/reconnect-chat-open'
    const log = decodeLog(flashFixture)
    const atSixtyHertz = {
      ...log,
      frames: Arr.map(log.frames, (frame, index) => ({ ...frame, at: (index * 1000) / 60 })),
    }

    expect(keysOf(detect(story, atSixtyHertz, expectationOf(story)))).toContain('flash:catching-up')
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
