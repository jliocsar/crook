export type TlaValue =
  | number
  | boolean
  | string
  | { readonly model: string }
  | readonly TlaValue[]
  | { readonly [key: string]: TlaValue }

export interface TraceState {
  readonly action: string
  readonly vars: Record<string, any>
}

const parseValue = (text: string): TlaValue => {
  let at = 0

  const skip = () => {
    while (at < text.length && /\s/.test(text[at] ?? '')) at += 1
  }

  const value = (): TlaValue => {
    skip()
    const char = text[at]

    if (char === '"') {
      const end = text.indexOf('"', at + 1)
      const found = text.slice(at + 1, end)

      at = end + 1

      return found
    }

    if (text.startsWith('<<', at)) {
      at += 2
      const items: TlaValue[] = []

      for (;;) {
        skip()
        if (text.startsWith('>>', at)) {
          at += 2

          return items
        }
        items.push(value())
        skip()
        if (text[at] === ',') at += 1
      }
    }

    if (char === '[') {
      at += 1
      const fields: Record<string, TlaValue> = {}

      for (;;) {
        skip()
        if (text[at] === ']') {
          at += 1

          return fields
        }
        const start = at

        while (/[A-Za-z0-9_]/.test(text[at] ?? '')) at += 1
        const key = text.slice(start, at)

        skip()
        at += 3
        fields[key] = value()
        skip()
        if (text[at] === ',') at += 1
      }
    }

    const start = at

    while (/[A-Za-z0-9_-]/.test(text[at] ?? '')) at += 1
    const word = text.slice(start, at)

    if (word === 'TRUE') return true
    if (word === 'FALSE') return false
    if (/^-?[0-9]+$/.test(word)) return Number(word)

    return { model: word }
  }

  return value()
}

const parseState = (block: string): TraceState => {
  const head = block.split('\n', 1)[0] ?? ''
  const action = /^State \d+: <(\w+)/.exec(head)?.[1] ?? 'Unknown'
  const vars: Record<string, TlaValue> = {}
  const parts = block.split(/\n\/\\ /).slice(1)

  for (const part of parts) {
    const equals = part.indexOf(' = ')

    vars[part.slice(0, equals)] = parseValue(part.slice(equals + 3))
  }

  return { action, vars }
}

export const behaviourIn = (output: string): readonly TraceState[] => {
  const start = output.indexOf('The behavior up to this point is:')

  if (start < 0) return []

  const rest = output.slice(start)
  const stop = rest.search(/\n\n\d+ states generated|\nError: The error occurred|\n\d+ states generated|\nThe number of states generated/)
  const blocks = (stop < 0 ? rest : rest.slice(0, stop)).split(/\n(?=State \d+:)/).slice(1)

  return blocks.map(parseState)
}
