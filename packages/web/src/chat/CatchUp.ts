import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'

import { chatItems, EMPTY_CHAT } from '@crook/web/chat/ChatItems'
import type { ThreadRow } from '@crook/web/chat/Thread'
import { LaptopCatchUp, NO_CATCH_UP, TranscriptView } from '@crook/web/chat/TranscriptState'
import type { Lapse, TranscriptLine } from '@crook/web/chat/TranscriptState'
import { clockTime } from '@crook/web/time/Clock'

export type CatchUp = Data.TaggedEnum<{
  Waiting: Record<never, never>
  Off: Record<never, never>
  Landed: {
    readonly keys: Arr.NonEmptyReadonlyArray<string>
    readonly lapse: Option.Option<Lapse>
  }
}>

export type Landed = Data.TaggedEnum.Value<CatchUp, 'Landed'>

export const CatchUp = Data.taggedEnum<CatchUp>()

const stampOf = ({ message }: TranscriptLine): Option.Option<DateTime.Utc> =>
  Match.value(message).pipe(
    Match.tagsExhaustive({
      User: (user) => user.timestamp,
      Assistant: (assistant) => assistant.timestamp,
      System: (system) => system.timestamp,
      UnrecognizedEntry: () => Option.none(),
      Malformed: () => Option.none(),
      Omitted: () => Option.none(),
    }),
  )

export const lapseOf = (lines: readonly TranscriptLine[]): Option.Option<Lapse> =>
  pipe(lines, Arr.map(stampOf), Arr.getSomes, (stamps) =>
    Option.all({ from: Arr.head(stamps), to: Arr.last(stamps) }),
  )

export const lapseLabel = (lapse: Lapse): string => {
  const from = clockTime(lapse.from)
  const to = clockTime(lapse.to)

  return from === to ? from : `${from} → ${to}`
}

const extendsCached = (
  cached: readonly TranscriptLine[],
  lines: readonly TranscriptLine[],
): boolean =>
  lines.length > cached.length &&
  Option.exists(
    Option.all([Arr.last(cached), Arr.get(lines, cached.length - 1)]),
    ([was, is]) => was === is,
  )

export const landedOver = (
  cached: readonly TranscriptLine[],
  fold: TranscriptView,
): TranscriptView =>
  new TranscriptView(
    Struct.evolve(fold, {
      catchUp: () =>
        extendsCached(cached, fold.lines)
          ? LaptopCatchUp.Landed({
              cached,
              lapse: lapseOf(Arr.drop(fold.lines, cached.length)),
            })
          : NO_CATCH_UP,
    }),
  )

export const pendingOver = (view: TranscriptView): TranscriptView =>
  Arr.isReadonlyArrayNonEmpty(view.lines)
    ? new TranscriptView(
        Struct.evolve(view, { catchUp: () => LaptopCatchUp.Pending({ lines: view.lines }) }),
      )
    : view

const keysOfRowsIn = (lines: readonly TranscriptLine[]): HashSet.HashSet<string> =>
  HashSet.fromIterable(Arr.map(chatItems(lines, EMPTY_CHAT.context), (item) => item.key))

const landedFrom = (
  cached: readonly TranscriptLine[],
  lapse: Option.Option<Lapse>,
  rows: readonly ThreadRow[],
): CatchUp => {
  const held = keysOfRowsIn(cached)

  return pipe(
    Arr.map(rows, (row) => row.key),
    Arr.filter((key) => !HashSet.has(held, key)),
    Arr.match({
      onEmpty: () => CatchUp.Off(),
      onNonEmpty: (fresh) => CatchUp.Landed({ keys: fresh, lapse }),
    }),
  )
}

export const nextCatchUp = (
  current: CatchUp,
  view: Option.Option<TranscriptView>,
  rows: readonly ThreadRow[],
): CatchUp =>
  CatchUp.$match(current, {
    Waiting: () =>
      Option.match(view, {
        onNone: () => current,
        onSome: (shown) =>
          LaptopCatchUp.$match(shown.catchUp, {
            None: () => CatchUp.Off(),
            Pending: () => current,
            Landed: ({ cached, lapse }) => landedFrom(cached, lapse, rows),
          }),
      }),
    Off: () => current,
    Landed: () =>
      Option.exists(view, (shown) => LaptopCatchUp.$is('Landed')(shown.catchUp))
        ? current
        : CatchUp.Off(),
  })

export const landedOf = (catchUp: CatchUp): Option.Option<Landed> =>
  Option.liftPredicate(catchUp, CatchUp.$is('Landed'))

export const withCatchUpDivider = (
  rows: readonly ThreadRow[],
  keys: readonly string[],
  divider: ThreadRow,
): readonly ThreadRow[] => {
  const fresh = HashSet.fromIterable(keys)

  return Option.match(
    Arr.findFirstIndex(rows, (row) => HashSet.has(fresh, row.key)),
    {
      onNone: () => rows,
      onSome: (index) => {
        const [before, after] = Arr.splitAt(rows, index)

        return [...before, divider, ...after]
      },
    },
  )
}
