import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Match from 'effect/Match'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'

import type { Expectation, Order as StateOrder } from '@crook/frames/Expectations'
import {
  bandAt,
  BandPlace,
  EMPTY_BAND_PIXELS,
  isStarved,
  marksOf,
  shows,
  showsEmptyBand,
  statesOf,
} from '@crook/frames/FrameLog'
import type { FrameLog, RecordedFrame, ShiftEntry, ShiftSource } from '@crook/frames/FrameLog'
import { MARKS, NEVER_TOGETHER } from '@crook/frames/Marks'
import type { MarkPair } from '@crook/frames/Marks'

interface Run {
  readonly frames: Arr.NonEmptyReadonlyArray<RecordedFrame>
  readonly before: Option.Option<RecordedFrame>
  readonly after: Option.Option<RecordedFrame>
}

export const Check = Schema.Literals(['flash', 'pair', 'shift', 'blank', 'empty', 'order'])
export type Check = typeof Check.Type

export const Finding = Schema.Struct({
  check: Check,
  key: Schema.String,
  story: Schema.String,
  firstFrame: Schema.Int,
  lastFrame: Schema.Int,
  imageFrame: Schema.Int,
  fromMs: Schema.Finite,
  toMs: Schema.Finite,
  marks: Schema.Array(Schema.String),
  states: Schema.String,
  words: Schema.String,
})
export type Finding = typeof Finding.Type

const FLASH_MS = 400

export const FLASH_FRAMES = 24

const FRAME_MS = FLASH_MS / FLASH_FRAMES

const first = (run: Run): RecordedFrame => Arr.headNonEmpty(run.frames)

const last = (run: Run): RecordedFrame => Arr.lastNonEmpty(run.frames)

const endOf = (run: Run): number =>
  Option.match(run.after, { onNone: () => last(run).at, onSome: (after) => after.at })

const millisecondsOf = (run: Run): number => Math.round(endOf(run) - first(run).at)

const heldMsOf = (run: Run): number => Math.round(last(run).at - first(run).at + FRAME_MS)

const namesOf = (frame: RecordedFrame): string => {
  const marks = marksOf(frame)

  return marks.length === 0 ? 'nothing marked' : marks.join(', ')
}

const runsWhere = (
  frames: readonly RecordedFrame[],
  holds: (frame: RecordedFrame) => boolean,
): readonly Run[] => {
  const held = pipe(
    frames,
    Arr.map((frame, index) => ({ frame, index })),
    Arr.filter(({ frame }) => holds(frame)),
    Arr.map(({ frame, index }, position) => ({ frame, index, island: index - position })),
  )

  return Arr.isReadonlyArrayNonEmpty(held)
    ? pipe(
        Arr.groupWith(held, (one, other) => one.island === other.island),
        Arr.map((group) => ({
          frames: Arr.map(group, ({ frame }) => frame),
          before: Arr.get(frames, Arr.headNonEmpty(group).index - 1),
          after: Arr.get(frames, Arr.lastNonEmpty(group).index + 1),
        })),
      )
    : []
}

const watchedFromMs = (log: FrameLog, expectation: Expectation): number =>
  Match.value(expectation.watchFrom).pipe(
    Match.when('mount', () => 0),
    Match.when('first-step', () =>
      Option.match(Arr.head(log.steps), { onNone: () => 0, onSome: (step) => step.at }),
    ),
    Match.exhaustive,
  )

const findingFromRun = (
  story: string,
  check: Check,
  key: string,
  run: Run,
  words: string,
  imageFrame: number = first(run).frame,
): Finding => ({
  check,
  key,
  story,
  firstFrame: first(run).frame,
  lastFrame: last(run).frame,
  imageFrame,
  fromMs: Math.round(first(run).at),
  toMs: Math.round(endOf(run)),
  marks: marksOf(first(run)),
  states: statesOf(first(run)),
  words,
})

const opacityIn = (frame: RecordedFrame, mark: string): number => frame.marks[mark]?.opacity ?? 0

const clearestFrameOf = (run: Run, mark: string): number =>
  Arr.reduce(run.frames, first(run), (clearest, frame) =>
    opacityIn(frame, mark) >= opacityIn(clearest, mark) ? frame : clearest,
  ).frame

const flashesOf = (
  story: string,
  frames: readonly RecordedFrame[],
  watchedFrom: number,
  flashFrames: number,
): readonly Finding[] => {
  const clockCounts = !isStarved(frames)
  const isFlash = (run: Run): boolean =>
    run.frames.length < flashFrames && !(clockCounts && heldMsOf(run) >= FLASH_MS)

  return Arr.flatMap(MARKS, ({ mark }) =>
    pipe(
      runsWhere(frames, (frame) => shows(frame, mark)),
      Arr.filter(
        (run) => first(run).frame >= watchedFrom && isFlash(run) && Option.isSome(run.after),
      ),
      Arr.map((run) =>
        findingFromRun(
          story,
          'flash',
          `flash:${mark}`,
          run,
          `"${mark}" showed for only ${run.frames.length} frames over ${heldMsOf(run)} ms and went away. A state has to hold ${flashFrames} frames or ${FLASH_MS} ms, or not show at all.${clockCounts ? '' : ' This run was starved, so its clock does not count.'}`,
          clearestFrameOf(run, mark),
        ),
      ),
    ),
  )
}

const pairsOf = (
  story: string,
  frames: readonly RecordedFrame[],
  pairs: readonly MarkPair[],
): readonly Finding[] =>
  Arr.flatMap(pairs, ([one, other]) =>
    Arr.map(
      runsWhere(frames, (frame) => shows(frame, one) && shows(frame, other)),
      (run) =>
        findingFromRun(
          story,
          'pair',
          `pair:${one}+${other}`,
          run,
          `"${one}" and "${other}" showed side by side for ${run.frames.length} frames (${millisecondsOf(run)} ms). This story does not allow that.`,
        ),
    ),
  )

const blanksOf = (story: string, frames: readonly RecordedFrame[]): readonly Finding[] =>
  Arr.map(
    runsWhere(frames, (frame) => frame.blank),
    (run) => {
      const before = Option.match(run.before, {
        onNone: () => 'the first frame',
        onSome: namesOf,
      })
      const after = Option.match(run.after, {
        onNone: () => 'the end of the recording',
        onSome: namesOf,
      })

      return findingFromRun(
        story,
        'blank',
        'blank',
        run,
        `The content area showed nothing for ${run.frames.length} frames (${millisecondsOf(run)} ms), between ${before} and ${after}.`,
      )
    },
  )

const widestFrameOf = (run: Run, place: BandPlace): RecordedFrame =>
  Arr.reduce(run.frames, first(run), (widest, frame) =>
    bandAt(frame, place) > bandAt(widest, place) ? frame : widest,
  )

const emptiesOf = (story: string, frames: readonly RecordedFrame[]): readonly Finding[] =>
  Arr.flatMap(BandPlace.literals, (place) =>
    Arr.map(
      runsWhere(frames, (frame) => showsEmptyBand(frame, place)),
      (run) => {
        const widest = widestFrameOf(run, place)

        return findingFromRun(
          story,
          'empty',
          `empty:${place}`,
          run,
          `The ${place} of the thread's viewport held no row across as much as ${bandAt(widest, place)} px, for ${run.frames.length} frames (${millisecondsOf(run)} ms) with the lift at ${widest.thread?.lift ?? 0} px at the widest. Past ${EMPTY_BAND_PIXELS} px this is not the thread's own spacing.`,
          widest.frame,
        )
      },
    ),
  )

const impactOf = (source: ShiftSource): number =>
  Math.hypot(source.to.x - source.from.x, source.to.y - source.from.y) *
  Math.max(source.from.width * source.from.height, source.to.width * source.to.height)

const moversOf = (entries: readonly ShiftEntry[]): readonly ShiftSource[] =>
  pipe(
    entries,
    Arr.flatMap((entry) => entry.sources),
    Arr.sortWith(impactOf, Order.flip(Order.Number)),
  )

const describeMove = (source: ShiftSource): string =>
  `${source.element} moved from x ${source.from.x}, y ${source.from.y}, ${source.from.width}x${source.from.height} to x ${source.to.x}, y ${source.to.y}, ${source.to.width}x${source.to.height}`

const frameAtOrAfter = (
  frames: readonly RecordedFrame[],
  at: number,
): Option.Option<RecordedFrame> =>
  Option.orElse(
    Arr.findFirst(frames, (frame) => frame.at >= at),
    () => Arr.last(frames),
  )

const shiftsOf = (
  story: string,
  log: FrameLog,
  frames: readonly RecordedFrame[],
  expectation: Expectation,
): readonly Finding[] => {
  const startsAt = Option.match(Arr.head(frames), {
    onNone: () => 0,
    onSome: (frame) => frame.at,
  })
  const watched = Arr.filter(log.shifts, (entry) => !entry.hadRecentInput && entry.at >= startsAt)
  const total = Arr.reduce(watched, 0, (sum, entry) => sum + entry.value)
  const opening = Option.flatMap(Arr.head(watched), (entry) => frameAtOrAfter(frames, entry.at))
  const closing = Option.flatMap(Arr.last(watched), (entry) => frameAtOrAfter(frames, entry.at))
  const mover = Arr.head(moversOf(watched))

  if (
    total <= expectation.shiftBudget ||
    Option.isNone(opening) ||
    Option.isNone(closing) ||
    Option.isNone(mover)
  ) {
    return []
  }

  return [
    {
      check: 'shift',
      key: `shift:${mover.value.element}`,
      story,
      firstFrame: opening.value.frame,
      lastFrame: closing.value.frame,
      imageFrame: opening.value.frame,
      fromMs: Math.round(opening.value.at),
      toMs: Math.round(closing.value.at),
      marks: marksOf(opening.value),
      states: statesOf(opening.value),
      words: `Layout shifted by ${total.toFixed(4)} in total over ${watched.length} shifts, above this story's budget of ${expectation.shiftBudget}. What moved most: ${describeMove(mover.value)}.`,
    },
  ]
}

const trackMarks = (track: string): readonly string[] =>
  pipe(
    MARKS,
    Arr.filter((definition) => definition.track === track),
    Arr.map((definition) => definition.mark),
  )

const stateChanges = (
  frames: readonly RecordedFrame[],
  track: string,
): readonly { readonly state: string; readonly frame: RecordedFrame }[] => {
  const marks = trackMarks(track)

  return pipe(
    frames,
    Arr.scan(
      { state: Option.none<string>(), landed: Option.none<RecordedFrame>() },
      (previous, frame) => {
        const showing = Arr.filter(marks, (mark) => shows(frame, mark))
        const kept = Option.filter(previous.state, (state) => showing.includes(state))
        const next = Option.orElse(kept, () => Arr.head(showing))
        const moved = Option.isSome(next) && !Option.contains(previous.state, next.value)

        return {
          state: Option.orElse(next, () => previous.state),
          landed: moved ? Option.some(frame) : Option.none(),
        }
      },
    ),
    Arr.flatMap(({ state, landed }) =>
      Option.isSome(state) && Option.isSome(landed)
        ? [{ state: state.value, frame: landed.value }]
        : [],
    ),
  )
}

const brokenOrderOf = (
  story: string,
  frames: readonly RecordedFrame[],
  track: string,
  order: StateOrder,
): readonly Finding[] => {
  const changes = stateChanges(frames, track)
  const allows = (from: Option.Option<string>, to: string): boolean =>
    Option.match(from, {
      onNone: () => order.next.has(to),
      onSome: (state) => (order.next.get(state) ?? []).includes(to),
    })

  return Arr.flatMap(changes, ({ state, frame }, index) => {
    const from = Option.map(Arr.get(changes, index - 1), (previous) => previous.state)
    const name = Option.getOrElse(from, () => 'start')

    return allows(from, state)
      ? []
      : [
          {
            check: 'order' as const,
            key: `order:${track}:${name}>${state}`,
            story,
            firstFrame: frame.frame,
            lastFrame: frame.frame,
            imageFrame: frame.frame,
            fromMs: Math.round(frame.at),
            toMs: Math.round(frame.at),
            marks: marksOf(frame),
            states: statesOf(frame),
            words: Option.match(from, {
              onNone: () =>
                `"${state}" showed first on the ${track} track, and this story does not allow it there.`,
              onSome: (previous) =>
                `"${previous}" gave way to "${state}" on the ${track} track, and this story does not allow that step.`,
            }),
          },
        ]
  })
}

export const detect = (
  story: string,
  log: FrameLog,
  expectation: Expectation,
  flashFrames: number = FLASH_FRAMES,
): readonly Finding[] => {
  const frames = Arr.filter(log.frames, (frame) => frame.mounted)
  const fromMs = watchedFromMs(log, expectation)

  return Option.match(
    Arr.findFirst(frames, (frame) => frame.at >= fromMs),
    {
      onNone: () => [],
      onSome: (start) => {
        const watched = Arr.filter(frames, (frame) => frame.frame >= start.frame)

        return Arr.sortWith(
          [
            ...flashesOf(story, frames, start.frame, flashFrames),
            ...pairsOf(story, watched, [...NEVER_TOGETHER, ...expectation.forbiddenPairs]),
            ...blanksOf(story, watched),
            ...emptiesOf(story, watched),
            ...shiftsOf(story, log, watched, expectation),
            ...Object.entries(expectation.order).flatMap(([track, order]) =>
              brokenOrderOf(story, watched, track, order),
            ),
          ],
          (finding: Finding) => finding.firstFrame,
          Order.Number,
        )
      },
    },
  )
}
