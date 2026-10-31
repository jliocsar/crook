import { useAtomValue } from '@effect/atom-react/Hooks'
import { RegistryContext } from '@effect/atom-react/RegistryContext'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import { MotionGlobalConfig, rootProjectionNode, useInstantLayoutTransition } from 'motion/react'
import * as React from 'react'

const UNCOVERING_ATTRIBUTE = 'data-uncovering'

const neverCoveredAtom = Atom.make(false)

const CoveredContext = React.createContext<Atom.Atom<boolean>>(neverCoveredAtom)

const shownWhileUncovered = <Value,>(
  covered: Atom.Atom<boolean>,
  source: Atom.Atom<Value>,
): Atom.Atom<Value> =>
  Atom.readable((get) => {
    const hidden = get(covered)

    return pipe(
      get.self<Value>(),
      Option.filter(() => hidden),
      Option.getOrElse(() => get(source)),
    )
  })

const afterFirstFrame = (run: () => void): (() => void) => {
  let pending = requestAnimationFrame(() => {
    pending = requestAnimationFrame(run)
  })

  return () => {
    cancelAnimationFrame(pending)
  }
}

export const useCoveredAtom = (): Atom.Atom<boolean> => React.useContext(CoveredContext)

export const useShownAtomValue = <Value,>(source: Atom.Atom<Value>): Value => {
  const covered = useCoveredAtom()
  const shown = React.useMemo(() => shownWhileUncovered(covered, source), [covered, source])

  return useAtomValue(shown)
}

export function CoveredScope({
  covered,
  children,
}: {
  covered: boolean
  children: React.ReactNode
}) {
  const registry = React.useContext(RegistryContext)
  const [coveredAtom] = React.useState(() => Atom.make(covered))
  const shownCovered = useAtomValue(coveredAtom)
  const scope = React.useRef<HTMLDivElement>(null)
  const uncovering = React.useRef(false)
  const instantLayout = useInstantLayoutTransition()

  React.useLayoutEffect(() => {
    if (covered === registry.get(coveredAtom)) {
      return
    }

    uncovering.current = !covered
    scope.current?.toggleAttribute(UNCOVERING_ATTRIBUTE, uncovering.current)
    registry.set(coveredAtom, covered)
  }, [covered, registry, coveredAtom])

  React.useInsertionEffect(() => {
    if (uncovering.current) {
      MotionGlobalConfig.instantAnimations = true
    }
  }, [shownCovered])

  React.useLayoutEffect(() => {
    if (uncovering.current && rootProjectionNode.current?.isUpdating === true) {
      instantLayout()
    }
  }, [shownCovered, instantLayout])

  React.useEffect(() => {
    if (!uncovering.current) {
      return undefined
    }

    uncovering.current = false
    MotionGlobalConfig.instantAnimations = false

    const settle = () => {
      scope.current?.toggleAttribute(UNCOVERING_ATTRIBUTE, false)
    }

    const cancel = afterFirstFrame(settle)

    return () => {
      cancel()
      settle()
    }
  }, [shownCovered])

  React.useEffect(
    () => () => {
      if (uncovering.current) {
        MotionGlobalConfig.instantAnimations = false
      }
    },
    [],
  )

  return (
    <div ref={scope} data-slot="covered-scope" className="contents">
      <CoveredContext value={coveredAtom}>{children}</CoveredContext>
    </div>
  )
}
