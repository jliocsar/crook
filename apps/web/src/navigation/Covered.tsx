import { useAtomValue } from '@effect/atom-react/Hooks'
import { RegistryContext } from '@effect/atom-react/RegistryContext'
import { constVoid, pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import * as Atom from 'effect/reactivity/Atom'
import { MotionGlobalConfig } from 'motion/react'
import * as React from 'react'

export type CoverPhase = 'shown' | 'arriving' | 'over'

type LivePhase = CoverPhase | 'typing'

export type PushedPosition = 'arriving' | 'over' | 'leaving'

interface Cover {
  readonly phase: Atom.Atom<LivePhase>
  readonly clocksStopped: Atom.Atom<boolean>
  readonly still: React.RefObject<boolean>
}

const STILL_ATTRIBUTE = 'data-still'
const TYPING_PAUSE_MS = 1000

const coverAt = (phase: Atom.Atom<LivePhase>, still: boolean): Cover => ({
  phase,
  clocksStopped: Atom.map(phase, (current) => current !== 'shown'),
  still: { current: still },
})

const NEVER_COVERED = coverAt(Atom.make<LivePhase>('shown'), false)
const ALWAYS_COVERED = coverAt(Atom.make<LivePhase>('arriving'), true)

const CoverContext = React.createContext<Cover>(NEVER_COVERED)

export const PushedPositionContext =
  React.createContext<(position: PushedPosition) => void>(constVoid)

const heldWhileUnsettled = <Value,>(
  phase: Atom.Atom<LivePhase>,
  source: Atom.Atom<Value>,
): Atom.Atom<Value> =>
  Atom.readable((get) => {
    const current = get(phase)

    return pipe(
      get.self<Value>(),
      Option.filter(() => current === 'arriving' || current === 'typing'),
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

export const coverPhaseOf = (pushed: boolean, position: PushedPosition): CoverPhase =>
  !pushed || position === 'leaving' ? 'shown' : position

export const useCoveredAtom = (): Atom.Atom<boolean> => React.useContext(CoverContext).clocksStopped

export const useShownAtomValue = <Value,>(source: Atom.Atom<Value>): Value => {
  const { phase } = React.useContext(CoverContext)
  const held = React.useMemo(() => heldWhileUnsettled(phase, source), [phase, source])
  const value = useAtomValue(held)
  const inBackground = React.useDeferredValue(value)
  const current = useAtomValue(phase)

  return current === 'over' || current === 'typing' ? inBackground : value
}

export const useIsStillUnderCover = (): boolean => React.useContext(CoverContext).still.current

function StillEdge({ instant }: { instant: boolean }) {
  const { still } = React.useContext(CoverContext)

  const apply = () => {
    if (still.current) {
      MotionGlobalConfig.instantAnimations = instant
    }
  }

  React.useLayoutEffect(apply)
  React.useEffect(apply)

  return null
}

export function StillUnderCover({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StillEdge instant />
      {children}
      <StillEdge instant={false} />
    </>
  )
}

export function FrozenScope({ children }: { children: React.ReactNode }) {
  return <CoverContext value={ALWAYS_COVERED}>{children}</CoverContext>
}

export function CoveredScope({
  phase,
  children,
}: {
  phase: CoverPhase
  children: React.ReactNode
}) {
  const registry = React.useContext(RegistryContext)
  const [phaseAtom] = React.useState(() => Atom.make<LivePhase>(phase))
  const [cover] = React.useState(() => coverAt(phaseAtom, phase !== 'shown'))
  const scope = React.useRef<HTMLDivElement>(null)

  React.useLayoutEffect(() => {
    cover.still.current = cover.still.current || phase !== 'shown'
    scope.current?.toggleAttribute(STILL_ATTRIBUTE, cover.still.current && phase !== 'arriving')
    registry.set(phaseAtom, phase)
  }, [phase, registry, phaseAtom, cover])

  React.useEffect(() => {
    if (phase !== 'over') {
      return undefined
    }

    let pause: number | undefined

    const whileCovered = (next: LivePhase) => {
      if (registry.get(phaseAtom) !== 'shown') {
        registry.set(phaseAtom, next)
      }
    }

    const onInput = () => {
      whileCovered('typing')
      window.clearTimeout(pause)
      pause = window.setTimeout(() => {
        whileCovered('over')
      }, TYPING_PAUSE_MS)
    }

    window.addEventListener('input', onInput, { capture: true, passive: true })

    return () => {
      window.removeEventListener('input', onInput, { capture: true })
      window.clearTimeout(pause)
    }
  }, [phase, registry, phaseAtom])

  React.useEffect(() => {
    if (phase !== 'shown') {
      return undefined
    }

    return afterFirstFrame(() => {
      cover.still.current = false
      scope.current?.toggleAttribute(STILL_ATTRIBUTE, false)
    })
  }, [phase, cover])

  return (
    <div ref={scope} data-slot="covered-scope" className="contents">
      <CoverContext value={cover}>{children}</CoverContext>
    </div>
  )
}
