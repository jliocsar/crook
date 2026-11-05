import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'

import { parseLine } from '@crook/claude/TranscriptParser'
import { TranscriptOffset } from '@crook/domain/Ids'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'

const encoder = new TextEncoder()

export const messagesOf = (jsonl: string): readonly TranscriptMessage[] =>
  pipe(
    jsonl.split('\n'),
    Arr.mapAccum(0, (offset, text): readonly [number, readonly TranscriptMessage[]] => {
      const bytes = encoder.encode(text)

      return [offset + bytes.length + 1, parseLine(bytes, TranscriptOffset.make(offset))]
    }),
    ([, parsed]) => Arr.flatten(parsed),
  )
