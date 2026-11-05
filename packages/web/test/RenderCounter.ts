import * as Predicate from 'effect/Predicate'

type FiberType = (() => void) | string | object | null

interface CommittedFiber {
  readonly type: FiberType
  readonly flags: number
  readonly child: CommittedFiber | null
  readonly sibling: CommittedFiber | null
  readonly alternate: CommittedFiber | null
}

interface CommittedRoot {
  readonly current: CommittedFiber
}

const PERFORMED_WORK = 1
const DEVTOOLS_HOOK = '__REACT_DEVTOOLS_GLOBAL_HOOK__'

const nameOf = ({ type }: CommittedFiber): string => (Predicate.isFunction(type) ? type.name : '')

const rendered = (fiber: CommittedFiber): boolean =>
  fiber.alternate === null || (fiber.flags & PERFORMED_WORK) !== 0

const countRenders = (fiber: CommittedFiber | null, counts: Map<string, number>): void => {
  if (fiber === null) {
    return
  }

  const name = nameOf(fiber)

  if (name !== '' && rendered(fiber)) {
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  if (fiber.alternate === null || fiber.child !== fiber.alternate.child) {
    countRenders(fiber.child, counts)
  }

  countRenders(fiber.sibling, counts)
}

export const RENDER_COUNTS = new Map<string, number>()

Reflect.set(globalThis, DEVTOOLS_HOOK, {
  supportsFiber: true,
  inject: () => 1,
  onCommitFiberRoot: (_renderer: number, root: CommittedRoot) => {
    countRenders(root.current, RENDER_COUNTS)
  },
  onCommitFiberUnmount: () => undefined,
  onPostCommitFiberRoot: () => undefined,
  checkDCE: () => undefined,
  isDisabled: false,
})
