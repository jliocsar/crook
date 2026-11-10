import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'

export interface FoldedLines {
  readonly lines: readonly string[]
  readonly clipped: boolean
}

export const LINE_BREAK = '\n'
export const PARAGRAPH_BREAK = `${LINE_BREAK}${LINE_BREAK}`
export const FOLDED_OUTPUT_LINES = 12
export const FOLDED_OUTPUT_CHARACTERS = 600
export const FOLDED_CODE_LINES = 10
export const FOLDED_CODE_CHARACTERS = 1000

export const foldedLines = (
  lines: readonly string[],
  maxLines: number,
  maxCharacters: number,
): FoldedLines => {
  const head = lines.slice(0, maxLines)
  const rooms = Arr.scan(
    head,
    maxCharacters,
    (room, line) => room - line.length - LINE_BREAK.length,
  )
  const kept = pipe(
    Arr.zip(head, rooms),
    Arr.takeWhile(([, room]) => room > 0),
    Arr.map(([line, room]) => line.slice(0, room)),
  )

  return {
    lines: kept,
    clipped: kept.length < lines.length || kept.at(-1) !== lines[kept.length - 1],
  }
}
