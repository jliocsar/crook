import * as Arr from 'effect/Array'

import { chunk, said } from '../test/TranscriptFixtures.ts'

const MANY_LINES = 120
const LINE_BYTES = 10

export const manyLinesChunk = (from: number) =>
  chunk(
    from,
    from + MANY_LINES * LINE_BYTES,
    Arr.makeBy(MANY_LINES, (index) => said(from + index * LINE_BYTES, `Line ${index}`)),
  )
