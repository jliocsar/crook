import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'
import { describe, expect, it } from 'vitest'

import {
  CatchUp,
  lapseLabel,
  lapseOf,
  nextCatchUp,
  withCatchUpDivider,
} from '@crook/web/chat/CatchUp'
import type { ThreadRow } from '@crook/web/chat/Thread'
import { TranscriptOffset } from '@crook/domain/Ids'
import { UnrecognizedEntry } from '@crook/domain/TranscriptMessage'
import {
  catchingUpFrom,
  EMPTY_TRANSCRIPT,
  failedWith,
  type TranscriptLine,
  TranscriptView,
} from '@crook/web/chat/TranscriptState'
import { HubCallDefected } from '@crook/web/rpc/HubConnection'
import { clockTime } from '@crook/web/time/Clock'

import { assistant, prompt, said, SESSION } from '../TranscriptFixtures.ts'

const line = (offset: number): TranscriptLine => ({
  session: SESSION,
  message: said(offset, `line ${offset}`),
})

const row = (key: string): ThreadRow => ({ key, content: key })

const rows = (...keys: readonly string[]): readonly ThreadRow[] => keys.map(row)

const MARKER = row('catch-up')

const viewOf = (lines: readonly TranscriptLine[], catchingUp: boolean) =>
  catchingUpFrom(
    new TranscriptView(Struct.evolve(EMPTY_TRANSCRIPT, { lines: () => lines })),
    catchingUp,
  )

const keysOf = (shown: readonly ThreadRow[]) => shown.map((found) => found.key)

const CACHED = [line(0), line(10)]

const cachedCatchUp = () =>
  nextCatchUp(CatchUp.Waiting(), Option.some(viewOf(CACHED, true)), rows('a', 'b'))

describe('nextCatchUp', () => {
  it('remembers the rows a reopened chat showed from its cache', () => {
    expect(CatchUp.$is('Cached')(cachedCatchUp())).toBe(true)
  })

  it('stays off for a cold open, which has nothing cached to catch up from', () => {
    const cold = nextCatchUp(CatchUp.Waiting(), Option.some(viewOf([], true)), [])

    expect(CatchUp.$is('Off')(cold)).toBe(true)
  })

  it('stays off when the chat opened already current', () => {
    const current = nextCatchUp(
      CatchUp.Waiting(),
      Option.some(viewOf(CACHED, false)),
      rows('a', 'b'),
    )

    expect(CatchUp.$is('Off')(current)).toBe(true)
  })

  it('names the rows that landed past the cache once the chat has caught up', () => {
    const landed = nextCatchUp(
      cachedCatchUp(),
      Option.some(viewOf([...CACHED, line(20), line(30)], false)),
      rows('a', 'b', 'c', 'd'),
    )

    expect(CatchUp.$is('Landed')(landed) && landed.keys).toStrictEqual(['c', 'd'])
  })

  it('waits while the chat is still catching up', () => {
    const waiting = cachedCatchUp()

    expect(nextCatchUp(waiting, Option.some(viewOf(CACHED, true)), rows('a', 'b'))).toBe(waiting)
  })

  it('turns off when nothing new landed', () => {
    const nothing = nextCatchUp(cachedCatchUp(), Option.some(viewOf(CACHED, false)), rows('a', 'b'))

    expect(CatchUp.$is('Off')(nothing)).toBe(true)
  })

  it('turns off when the chat started over instead of extending the cache', () => {
    const restarted = nextCatchUp(
      cachedCatchUp(),
      Option.some(viewOf([line(0), line(10), line(20)], false)),
      rows('a', 'b', 'c'),
    )

    expect(CatchUp.$is('Off')(restarted)).toBe(true)
  })

  it('turns off when the watch failed', () => {
    const failed = nextCatchUp(
      cachedCatchUp(),
      Option.some(
        failedWith(viewOf([...CACHED, line(20)], true), new HubCallDefected({ cause: 'gone' })),
      ),
      rows('a', 'b', 'c'),
    )

    expect(CatchUp.$is('Off')(failed)).toBe(true)
  })

  it('keeps what landed for as long as the chat stays open', () => {
    const landed = nextCatchUp(
      cachedCatchUp(),
      Option.some(viewOf([...CACHED, line(20)], false)),
      rows('a', 'b', 'c'),
    )

    expect(
      nextCatchUp(
        landed,
        Option.some(viewOf([...CACHED, line(20), line(30)], false)),
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
