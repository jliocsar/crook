import * as Arr from 'effect/Array'
import * as Data from 'effect/Data'
import type * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'

import type { ThreadRow } from '@crook/web/chat/Thread'
import { TranscriptLine } from '@crook/web/chat/TranscriptState'
import type { TranscriptView } from '@crook/web/chat/TranscriptState'
import { clockTime } from '@crook/web/time/Clock'

export interface Lapse {
  readonly from: DateTime.Utc
  readonly to: DateTime.Utc
}

export type CatchUp = Data.TaggedEnum<{
  Waiting: Record<never, never>
  Off: Record<never, never>
  Cached: { readonly lines: readonly TranscriptLine[]; readonly keys: HashSet.HashSet<string> }
  Landed: {
    readonly keys: Arr.NonEmptyReadonlyArray<string>
    readonly lapse: Option.Option<Lapse>
  }
}>

export type Landed = Data.TaggedEnum.Value<CatchUp, 'Landed'>

export const CatchUp = Data.taggedEnum<CatchUp>()

const stampOf = (line: TranscriptLine): Option.Option<DateTime.Utc> =>
  TranscriptLine.$match(line, {
    SessionCleared: () => Option.none(),
    Message: ({ message }) =>
      Match.value(message).pipe(
        Match.tagsExhaustive({
          User: (user) => user.timestamp,
          Assistant: (assistant) => assistant.timestamp,
          System: (system) => system.timestamp,
          UnrecognizedEntry: () => Option.none(),
          Malformed: () => Option.none(),
          Omitted: () => Option.none(),
        }),
      ),
  })

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

const openedWith =
  (rows: readonly ThreadRow[]) =>
  (view: TranscriptView): CatchUp =>
    view.catchingUp && Arr.isReadonlyArrayNonEmpty(view.lines)
      ? CatchUp.Cached({
          lines: view.lines,
          keys: HashSet.fromIterable(Arr.map(rows, (row) => row.key)),
        })
      : CatchUp.Off()

const landedFrom = (
  cached: Data.TaggedEnum.Value<CatchUp, 'Cached'>,
  view: TranscriptView,
  rows: readonly ThreadRow[],
): CatchUp =>
  pipe(
    Option.liftPredicate(
      view,
      (shown) => Option.isNone(shown.failure) && extendsCached(cached.lines, shown.lines),
    ),
    Option.flatMap((shown) =>
      pipe(
        Arr.map(rows, (row) => row.key),
        Arr.filter((key) => !HashSet.has(cached.keys, key)),
        Arr.match({
          onEmpty: () => Option.none<CatchUp>(),
          onNonEmpty: (keys) =>
            Option.some(
              CatchUp.Landed({ keys, lapse: lapseOf(Arr.drop(shown.lines, cached.lines.length)) }),
            ),
        }),
      ),
    ),
    Option.getOrElse(() => CatchUp.Off()),
  )

export const nextCatchUp = (
  current: CatchUp,
  view: Option.Option<TranscriptView>,
  rows: readonly ThreadRow[],
): CatchUp =>
  CatchUp.$match(current, {
    Waiting: () => Option.match(view, { onNone: () => current, onSome: openedWith(rows) }),
    Cached: (cached) =>
      pipe(
        view,
        Option.filter((shown) => !shown.catchingUp),
        Option.match({
          onNone: () => current,
          onSome: (shown) => landedFrom(cached, shown, rows),
        }),
      ),
    Off: () => current,
    Landed: () => current,
  })

export const landedOf = (catchUp: CatchUp): Option.Option<Landed> =>
  Option.liftPredicate(catchUp, CatchUp.$is('Landed'))

export const releasedRows = (
  rows: readonly ThreadRow[],
  keys: readonly string[],
  shown: number,
  marker: ThreadRow,
): readonly ThreadRow[] => {
  const indexOf = HashMap.fromIterable(Arr.map(rows, (row, index) => [row.key, index] as const))
  const [released, held] = Arr.splitAt(keys, shown)
  const visible = Option.match(
    Arr.findFirst(held, (key) => HashMap.get(indexOf, key)),
    { onNone: () => rows, onSome: (index) => Arr.take(rows, index) },
  )
  const markerAt = Option.match(
    Arr.findLast(released, (key) => HashMap.get(indexOf, key)),
    { onNone: () => visible.length, onSome: (index) => index + 1 },
  )
  const [before, after] = Arr.splitAt(visible, markerAt)

  return [...before, marker, ...after]
}
