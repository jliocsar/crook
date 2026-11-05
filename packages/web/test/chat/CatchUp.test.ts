import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'
import { describe, expect, it } from 'vitest'

import {
  CatchUp,
  landedOver,
  lapseLabel,
  lapseOf,
  nextCatchUp,
  withCatchUpDivider,
} from '@crook/web/chat/CatchUp'
import type { ThreadRow } from '@crook/web/chat/Thread'
import { TranscriptOffset } from '@crook/domain/Ids'
import { UnrecognizedEntry } from '@crook/domain/TranscriptMessage'
import {
  EMPTY_TRANSCRIPT,
  LaptopCatchUp,
  NO_CATCH_UP,
  type TranscriptLine,
  TranscriptView,
} from '@crook/web/chat/TranscriptState'
import { clockTime } from '@crook/web/time/Clock'

import { assistant, prompt, said, SESSION } from '../TranscriptFixtures.ts'

const line = (offset: number): TranscriptLine => ({
  session: SESSION,
  message: said(offset, `line ${offset}`),
})

const row = (key: string): ThreadRow => ({ key, content: key })

const rows = (...keys: readonly string[]): readonly ThreadRow[] => keys.map(row)

const MARKER = row('catch-up')

const viewOf = (lines: readonly TranscriptLine[], catchUp: LaptopCatchUp = NO_CATCH_UP) =>
  new TranscriptView(
    Struct.evolve(EMPTY_TRANSCRIPT, { lines: () => lines, catchUp: () => catchUp }),
  )

const keysOf = (shown: readonly ThreadRow[]) => shown.map((found) => found.key)

const CACHED = [line(0), line(10)]

const pending = (lines: readonly TranscriptLine[]) =>
  viewOf(lines, LaptopCatchUp.Pending({ lines }))

const landedView = (lines: readonly TranscriptLine[]) =>
  viewOf(lines, LaptopCatchUp.Landed({ lapse: Option.none() }))

const cachedCatchUp = () =>
  nextCatchUp(CatchUp.Waiting(), Option.some(pending(CACHED)), rows('a', 'b'))

describe('landedOver', () => {
  it('names the lapse of the lines past the cache', () => {
    const landed = landedOver(CACHED, viewOf([...CACHED, line(20)]))

    expect(LaptopCatchUp.$is('Landed')(landed.catchUp)).toBe(true)
  })

  it('lands nothing when the read added no line', () => {
    expect(landedOver(CACHED, viewOf(CACHED)).catchUp).toEqual(NO_CATCH_UP)
  })

  it('lands nothing when the read started over instead of extending the cache', () => {
    expect(landedOver(CACHED, viewOf([line(0), line(10), line(20)])).catchUp).toEqual(NO_CATCH_UP)
  })
})

describe('nextCatchUp', () => {
  it('remembers the rows a reopened chat showed from its cache', () => {
    expect(CatchUp.$is('Remembered')(cachedCatchUp())).toBe(true)
  })

  it('stays off for a chat that opened with nothing to catch up from', () => {
    const cold = nextCatchUp(CatchUp.Waiting(), Option.some(viewOf(CACHED)), rows('a', 'b'))

    expect(CatchUp.$is('Off')(cold)).toBe(true)
  })

  it('keeps waiting while nothing shows', () => {
    const waiting = CatchUp.Waiting()

    expect(nextCatchUp(waiting, Option.none(), [])).toBe(waiting)
  })

  it('names the rows that landed past the cache once the chat has caught up', () => {
    const landed = nextCatchUp(
      cachedCatchUp(),
      Option.some(landedView([...CACHED, line(20), line(30)])),
      rows('a', 'b', 'c', 'd'),
    )

    expect(CatchUp.$is('Landed')(landed) && landed.keys).toStrictEqual(['c', 'd'])
  })

  it('waits while the machine still holds the read back', () => {
    const waiting = cachedCatchUp()

    expect(nextCatchUp(waiting, Option.some(pending(CACHED)), rows('a', 'b'))).toBe(waiting)
  })

  it('turns off when the landed read added no row', () => {
    const nothing = nextCatchUp(
      cachedCatchUp(),
      Option.some(landedView([...CACHED, line(20)])),
      rows('a', 'b'),
    )

    expect(CatchUp.$is('Off')(nothing)).toBe(true)
  })

  it('turns off when the machine judged no catch-up', () => {
    const off = nextCatchUp(cachedCatchUp(), Option.some(viewOf(CACHED)), rows('a', 'b'))

    expect(CatchUp.$is('Off')(off)).toBe(true)
  })

  it('turns off when the session goes', () => {
    const landed = nextCatchUp(
      cachedCatchUp(),
      Option.some(landedView([...CACHED, line(20)])),
      rows('a', 'b', 'c'),
    )

    expect(CatchUp.$is('Off')(nextCatchUp(landed, Option.none(), []))).toBe(true)
  })

  it('keeps what landed for as long as the session stays', () => {
    const landed = nextCatchUp(
      cachedCatchUp(),
      Option.some(landedView([...CACHED, line(20)])),
      rows('a', 'b', 'c'),
    )

    expect(
      nextCatchUp(
        landed,
        Option.some(landedView([...CACHED, line(20), line(30)])),
        rows('a', 'b', 'c', 'sent'),
      ),
    ).toBe(landed)
  })
})

describe('withCatchUpDivider', () => {
  const fresh = ['c', 'd']

  it('puts the divider above the first new row', () => {
    expect(keysOf(withCatchUpDivider(rows('a', 'b', 'c', 'd'), fresh, MARKER))).toStrictEqual([
      'a',
      'b',
      'catch-up',
      'c',
      'd',
    ])
  })

  it('stays above the first new row when later rows follow', () => {
    expect(keysOf(withCatchUpDivider(rows('a', 'c', 'd', 'later'), fresh, MARKER))).toStrictEqual([
      'a',
      'catch-up',
      'c',
      'd',
      'later',
    ])
  })

  it('moves down to the next new row when the first is no longer shown', () => {
    expect(keysOf(withCatchUpDivider(rows('a', 'd'), fresh, MARKER))).toStrictEqual([
      'a',
      'catch-up',
      'd',
    ])
  })

  it('shows no divider once no new row is shown', () => {
    expect(keysOf(withCatchUpDivider(rows('a', 'b'), fresh, MARKER))).toStrictEqual(['a', 'b'])
  })
})

describe('lapseOf', () => {
  it('spans the first and last stamped line', () => {
    const lapse = lapseOf([
      { session: SESSION, message: prompt(0, 'go') },
      { session: SESSION, message: assistant(10, [], 42) },
    ])

    expect(Option.map(lapse, (found) => DateTime.formatIso(found.to))).toStrictEqual(
      Option.some('2026-10-20T12:00:42.000Z'),
    )
    expect(Option.map(lapse, (found) => DateTime.formatIso(found.from))).toStrictEqual(
      Option.some('2026-10-20T12:00:00.000Z'),
    )
  })

  it('is none when no line carries a time', () => {
    expect(
      lapseOf([
        {
          session: SESSION,
          message: new UnrecognizedEntry({ offset: TranscriptOffset.make(0), entryType: 'mode' }),
        },
      ]),
    ).toStrictEqual(Option.none())
  })
})

describe('lapseLabel', () => {
  const from = DateTime.makeUnsafe('2026-10-20T14:14:00Z')
  const to = DateTime.makeUnsafe('2026-10-20T14:25:00Z')

  it('reads as a range from the first to the last time', () => {
    expect(lapseLabel({ from, to })).toBe(`${clockTime(from)} → ${clockTime(to)}`)
  })

  it('reads as one time when everything happened within a minute', () => {
    expect(lapseLabel({ from, to: from })).toBe(clockTime(from))
  })

  it('drops the day period, as the divider shows only the clock', () => {
    expect(clockTime(from)).not.toMatch(/AM|PM/u)
  })
})
