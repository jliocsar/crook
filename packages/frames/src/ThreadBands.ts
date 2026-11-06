export interface VerticalBox {
  readonly top: number
  readonly bottom: number
  readonly height: number
}

export interface Bands {
  readonly top: number
  readonly middle: number
  readonly bottom: number
}

export interface RowTop {
  readonly key: string
  readonly top: number
}

export const bandsOf = (
  viewport: VerticalBox,
  content: VerticalBox,
  rows: readonly VerticalBox[],
): Bands => {
  const from = Math.max(viewport.top, content.top)
  const to = Math.min(viewport.bottom, content.bottom)
  const inView = rows
    .filter((row) => row.height > 0 && row.bottom > from && row.top < to)
    .toSorted((one, other) => one.top - other.top)
  const [firstRow] = inView

  if (firstRow === undefined) {
    return { top: Math.max(0, to - from), middle: 0, bottom: 0 }
  }

  const walked = inView.reduce(
    (walk, row) => ({
      reached: Math.max(walk.reached, row.bottom),
      middle: Math.max(walk.middle, row.top - walk.reached),
    }),
    { reached: firstRow.bottom, middle: 0 },
  )

  return {
    top: Math.max(0, firstRow.top - from),
    middle: walked.middle,
    bottom: Math.max(0, to - walked.reached),
  }
}

export const movedSince = (
  previous: ReadonlyMap<string, number>,
  rows: readonly RowTop[],
): number =>
  rows
    .flatMap((row) => {
      const before = previous.get(row.key)

      return before === undefined ? [] : [row.top - before]
    })
    .at(-1) ?? 0
