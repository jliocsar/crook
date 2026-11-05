import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Number from 'effect/Number'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

export const STARVED_P90_FRAME_MS = 30

export const Box = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
})
export type Box = typeof Box.Type

export const MarkReading = Schema.Struct({ ...Box.fields, opacity: Schema.Finite })
export type MarkReading = typeof MarkReading.Type

export const RecordedFrame = Schema.Struct({
  frame: Schema.Int,
  at: Schema.Finite,
  vsync: Schema.Finite,
  phase: Schema.String,
  mounted: Schema.Boolean,
  blank: Schema.Boolean,
  rows: Schema.Int,
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
