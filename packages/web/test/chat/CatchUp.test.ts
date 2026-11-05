import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'
import { describe, expect, it } from 'vitest'

import { parseLine } from '@crook/claude/TranscriptParser'
import compactionAuto from '@crook/claude/fixtures/compaction-auto.jsonl?raw'
import plainTurn from '@crook/claude/fixtures/plain-turn.jsonl?raw'
import subagentSession from '@crook/claude/fixtures/subagent/ff0f77be-1e98-4bb2-8b24-38d673361867.jsonl?raw'
import toolUseAndResult from '@crook/claude/fixtures/tool-use-and-result.jsonl?raw'
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
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import { chatItems, EMPTY_CHAT } from '@crook/web/chat/ChatItems'
import {
  EMPTY_TRANSCRIPT,
  LaptopCatchUp,
  NO_CATCH_UP,
  type TranscriptLine,
  TranscriptView,
} from '@crook/web/chat/TranscriptState'
import { clockTime } from '@crook/web/time/Clock'

import { assistant, prompt, said, SESSION } from '../TranscriptFixtures.ts'

const REAL_TRANSCRIPTS = [
  ['a plain turn', plainTurn],
  ['a tool call and its result', toolUseAndResult],
  ['a compaction', compactionAuto],
  ['a session with subagents', subagentSession],
] as const

const encoder = new TextEncoder()

const messagesOf = (jsonl: string): readonly TranscriptMessage[] =>
  pipe(
    jsonl.split('\n'),
    Arr.mapAccum(0, (offset, text): readonly [number, readonly TranscriptMessage[]] => {
      const bytes = encoder.encode(text)

      return [offset + bytes.length + 1, parseLine(bytes, TranscriptOffset.make(offset))]
    }),
    ([, parsed]) => Arr.flatten(parsed),
  )

const fixtureLines = (jsonl: string): readonly TranscriptLine[] =>
  messagesOf(jsonl).map((message) => ({ session: SESSION, message }))

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
  viewOf(lines, LaptopCatchUp.Landed({ cached: CACHED, lapse: Option.none() }))

const rowsOf = (lines: readonly TranscriptLine[]) =>
  rows(...chatItems(lines, EMPTY_CHAT.context).map((item) => item.key))

const waiting = () => nextCatchUp(CatchUp.Waiting(), Option.some(pending(CACHED)), rowsOf(CACHED))

const landedOf = (lines: readonly TranscriptLine[], shownRows = rowsOf(lines)) =>
  nextCatchUp(waiting(), Option.some(landedView(lines)), shownRows)

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
  it('waits on a reopened chat until its read ends', () => {
    expect(CatchUp.$is('Waiting')(waiting())).toBe(true)
  })

  it('stays off for a chat that opened with nothing to catch up from', () => {
    const cold = nextCatchUp(CatchUp.Waiting(), Option.some(viewOf(CACHED)), rows('a', 'b'))

    expect(CatchUp.$is('Off')(cold)).toBe(true)
  })

  it('keeps waiting while nothing shows', () => {
    const before = CatchUp.Waiting()

    expect(nextCatchUp(before, Option.none(), [])).toBe(before)
  })

  it('names the rows that landed past the cache once the chat has caught up', () => {
    const landed = landedOf([...CACHED, line(20), line(30)])

    expect(CatchUp.$is('Landed')(landed) && landed.keys).toStrictEqual(
      keysOf(rowsOf([line(20), line(30)])),
    )
  })

  it('names them just the same when the cached rows never committed', () => {
    const lines = [...CACHED, line(20)]
    const landed = nextCatchUp(CatchUp.Waiting(), Option.some(landedView(lines)), rowsOf(lines))

    expect(CatchUp.$is('Landed')(landed) && landed.keys).toStrictEqual(keysOf(rowsOf([line(20)])))
  })

  it('waits while the machine still holds the read back', () => {
    const before = waiting()

    expect(nextCatchUp(before, Option.some(pending(CACHED)), rowsOf(CACHED))).toBe(before)
  })

  it('turns off when the landed read added no row', () => {
    expect(CatchUp.$is('Off')(landedOf([...CACHED, line(20)], rowsOf(CACHED)))).toBe(true)
  })

  it('turns off when the machine judged no catch-up', () => {
    const off = nextCatchUp(waiting(), Option.some(viewOf(CACHED)), rowsOf(CACHED))

    expect(CatchUp.$is('Off')(off)).toBe(true)
  })

  it('turns off when the session goes', () => {
    expect(
      CatchUp.$is('Off')(nextCatchUp(landedOf([...CACHED, line(20)]), Option.none(), [])),
    ).toBe(true)
  })

  it('keeps what landed for as long as the session stays', () => {
    const lines = [...CACHED, line(20)]
    const landed = landedOf(lines)

    expect(
      nextCatchUp(landed, Option.some(landedView([...lines, line(30)])), [
        ...rowsOf(lines),
        row('sent'),
      ]),
    ).toBe(landed)
  })

  it.each(REAL_TRANSCRIPTS)(
    'finds a row the cache held under the same key once any more of %s has landed',
    (_name, jsonl) => {
      const lines = fixtureLines(jsonl)
      const whole = new Set(keysOf(rowsOf(lines)))
      const prefixes = Arr.makeBy(lines.length, (end) => lines.slice(0, end + 1))

      expect(
        prefixes.flatMap((prefix) => keysOf(rowsOf(prefix)).filter((key) => !whole.has(key))),
      ).toStrictEqual([])
    },
  )
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
