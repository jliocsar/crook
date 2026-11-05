import * as Arr from 'effect/Array'

import { answered, chunk, prompt, said, toolResult, toolUse } from '../test/TranscriptFixtures.ts'

const MANY_LINES = 120
const LINE_BYTES = 10
const MANY_TURNS = 16
const LINES_PER_TURN = 4

export const MANY_LINES_END = MANY_LINES * LINE_BYTES
export const MANY_TURNS_END = MANY_TURNS * LINES_PER_TURN * LINE_BYTES

export const manyLinesChunk = (from: number) =>
  chunk(
    from,
    from + MANY_LINES_END,
    Arr.makeBy(MANY_LINES, (index) => said(from + index * LINE_BYTES, `Line ${index}`)),
  )

const turn = (from: number, index: number) => {
  const id = `toolu_turn_${index}`

  return [
    prompt(from, `Question ${index}: does the thread stay filled while this lands?`),
    toolUse(from + LINE_BYTES, id, 'Grep', { pattern: `landing ${index}` }),
    toolResult(from + 2 * LINE_BYTES, id, `src/chat/Landing.ts:${index}`),
    answered(
      from + 3 * LINE_BYTES,
      `Answer ${index}: a catch-up of real turns mixes short tool rows with answers that run over a few lines, so its rows are nothing like one height, and an estimate is only ever an estimate.`,
    ),
  ]
}

export const manyTurnsChunk = (from: number) =>
  chunk(
    from,
    from + MANY_TURNS_END,
    Arr.makeBy(MANY_TURNS, (index) =>
      turn(from + index * LINES_PER_TURN * LINE_BYTES, index),
    ).flat(),
  )
