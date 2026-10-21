import * as Option from 'effect/Option'
import * as React from 'react'

interface RowMemory {
  readonly recall: (slot: string) => Option.Option<boolean>
  readonly remember: (slot: string, value: boolean) => void
}

const RowMemoryContext = React.createContext<Option.Option<RowMemory>>(Option.none())

export const useRowFlag = (
  slot: string,
  initial: boolean,
): readonly [boolean, (next: boolean) => void] => {
  const memory = React.useContext(RowMemoryContext)
  const [value, setValue] = React.useState(() =>
    Option.getOrElse(
      Option.flatMap(memory, (found) => found.recall(slot)),
      () => initial,
    ),
  )

  const set = (next: boolean) => {
    setValue(next)

    if (Option.isSome(memory)) {
      memory.value.remember(slot, next)
    }
  }

  return [value, set]
}

export function RowMemoryScope({
  store,
  rowKey,
  children,
}: {
  store: Map<string, boolean>
  rowKey: string
  children: React.ReactNode
}) {
  const memory = React.useMemo(
    () =>
      Option.some<RowMemory>({
        recall: (slot) => Option.fromUndefinedOr(store.get(`${rowKey} ${slot}`)),
        remember: (slot, value) => {
          store.set(`${rowKey} ${slot}`, value)
        },
      }),
    [store, rowKey],
  )

  return <RowMemoryContext.Provider value={memory}>{children}</RowMemoryContext.Provider>
}
