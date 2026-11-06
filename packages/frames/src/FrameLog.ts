import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Number from 'effect/Number'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

export const STARVED_P90_FRAME_MS = 30
export const EMPTY_BAND_PIXELS = 20
export const BACKTRACK_PIXELS = 2

export const Box = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
})
export type Box = typeof Box.Type

export const MarkReading = Schema.Struct({ ...Box.fields, opacity: Schema.Finite })
export type MarkReading = typeof MarkReading.Type

export const ThreadReading = Schema.Struct({
  lift: Schema.Finite,
  top: Schema.Finite,
  middle: Schema.Finite,
  bottom: Schema.Finite,
  moved: Schema.optional(Schema.Finite),
  held: Schema.optional(Schema.Boolean),
})
export type ThreadReading = typeof ThreadReading.Type

export const BandPlace = Schema.Literals(['top', 'middle', 'bottom'])
export type BandPlace = typeof BandPlace.Type

export const RecordedFrame = Schema.Struct({
  frame: Schema.Int,
  at: Schema.Finite,
  vsync: Schema.Finite,
  phase: Schema.String,
  mounted: Schema.Boolean,
  blank: Schema.Boolean,
  rows: Schema.Int,
  thread: Schema.optional(ThreadReading),
  marks: Schema.Record(Schema.String, MarkReading),
  states: Schema.Record(Schema.String, Schema.String),
  added: Schema.Array(Schema.String),
  removed: Schema.Array(Schema.String),
  readMs: Schema.Finite,
})
export type RecordedFrame = typeof RecordedFrame.Type

export const ShiftSource = Schema.Struct({ element: Schema.String, from: Box, to: Box })
export type ShiftSource = typeof ShiftSource.Type

export const ShiftEntry = Schema.Struct({
  at: Schema.Finite,
  value: Schema.Finite,
  hadRecentInput: Schema.Boolean,
  sources: Schema.Array(ShiftSource),
})
export type ShiftEntry = typeof ShiftEntry.Type

export const StepEntry = Schema.Struct({
  index: Schema.Int,
  label: Schema.String,
  at: Schema.Finite,
})
export type StepEntry = typeof StepEntry.Type

export const FrameLog = Schema.Struct({
  timeOrigin: Schema.Finite,
  frames: Schema.Array(RecordedFrame),
  shifts: Schema.Array(ShiftEntry),
  steps: Schema.Array(StepEntry),
})
export type FrameLog = typeof FrameLog.Type

export const FrameLogJson = Schema.fromJsonString(FrameLog)

export const marksOf = (frame: RecordedFrame): readonly string[] => Object.keys(frame.marks)

export const statesOf = (frame: RecordedFrame): string =>
  Object.entries(frame.states)
    .map(([machine, state]) => `${machine}=${state}`)
    .join(', ')

export const shows = (frame: RecordedFrame, mark: string): boolean =>
  frame.marks[mark] !== undefined

export const bandAt = (frame: RecordedFrame, place: BandPlace): number => frame.thread?.[place] ?? 0

export const showsEmptyBand = (frame: RecordedFrame, place: BandPlace): boolean =>
  bandAt(frame, place) > EMPTY_BAND_PIXELS

export const movedAt = (frame: RecordedFrame): number => frame.thread?.moved ?? 0

export const backtracks = (frame: RecordedFrame, next: RecordedFrame): boolean =>
  next.frame === frame.frame + 1 &&
  frame.thread?.held !== true &&
  next.thread?.held !== true &&
  movedAt(frame) <= -BACKTRACK_PIXELS &&
  movedAt(next) >= BACKTRACK_PIXELS

export const p90FrameMs = (frames: readonly RecordedFrame[]): number => {
  const mounted = frames.filter((frame) => frame.mounted)
  const later = Arr.drop(mounted, 1)
  const gaps = pipe(
    Arr.zipWith(later, mounted, (next, frame) => next.at - frame.at),
    Arr.sort(Number.Order),
  )

  return Option.getOrElse(Arr.get(gaps, Math.floor(gaps.length * 0.9)), () => 0)
}

export const isStarved = (frames: readonly RecordedFrame[]): boolean =>
  p90FrameMs(frames) > STARVED_P90_FRAME_MS
