import * as Effect from 'effect/Effect'

const COMPILED_ENTRY_ROOT = '/$bunfs/'

export const programFrom = (executable: string, entry: string): readonly string[] =>
  entry.startsWith(COMPILED_ENTRY_ROOT) ? [executable] : [executable, entry]

export const runningProgram = Effect.sync(() => programFrom(process.execPath, Bun.main))
