import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import type { RecordedFrame } from '@crook/frames/FrameLog'

export const NO_IMAGE = 'no screencast frame yet'

export const Shot = Schema.Struct({ index: Schema.Int, at: Schema.Finite, file: Schema.String })
export type Shot = typeof Shot.Type

export const shotOfFrame = (
  shots: readonly Shot[],
  frames: readonly RecordedFrame[],
  frameNumber: number,
): Option.Option<Shot> => {
  const nextFrameAt = Option.map(
    Arr.findFirst(frames, (frame) => frame.frame === frameNumber + 1),
    (frame) => frame.at,
  )

  return Option.match(nextFrameAt, {
    onNone: () => Arr.last(shots),
    onSome: (until) => Arr.findLast(shots, (shot) => shot.at <= until),
  })
}

export const imageWithItsAge = (
  shots: readonly Shot[],
  frames: readonly RecordedFrame[],
  frameNumber: number,
): string =>
  pipe(
    shotOfFrame(shots, frames, frameNumber),
    Option.flatMap((shot) =>
      Option.map(
        Arr.findFirst(frames, (frame) => frame.frame === frameNumber),
        (frame) => {
          const age = Math.round(frame.at - shot.at)

          return age >= 0
            ? `${shot.file} (taken ${age} ms before this frame)`
            : `${shot.file} (taken ${-age} ms after this frame)`
        },
      ),
    ),
    Option.getOrElse(() => NO_IMAGE),
  )
