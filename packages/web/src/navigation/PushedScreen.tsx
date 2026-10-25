import type { ParsedHistoryState } from '@tanstack/history'
import { useParentMatches, useRouter, useRouterState } from '@tanstack/react-router'
import type { AnyRouter } from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import { ChevronLeft } from 'lucide-react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import * as React from 'react'

import { useAxisLock } from '@crook/web/components/swipe/AxisLock'
import { Button } from '@crook/web/components/ui/button'
import { HeaderBanner } from '@crook/web/connection/ConnectionBanner'
import { GLIDE } from '@crook/web/motion/Springs'
import { COLUMN_STYLE, useColumnWidth } from '@crook/web/navigation/Column'
import { focusScreenTitle, restoreFocus } from '@crook/web/navigation/Focus'
import { keyboardFitStyle, useKeyboardFit } from '@crook/web/navigation/KeyboardFit'
import { findOpener } from '@crook/web/navigation/Opener'
import { useCoveredByPushedScreen } from '@crook/web/navigation/Pushed'
import { useShellReady } from '@crook/web/navigation/ShellReady'

type EdgeHandlers = Pick<
  React.DOMAttributes<HTMLDivElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
>

type HistoryEntry = { readonly state: ParsedHistoryState }

type BackGesture = {
  readonly offset: number
  readonly velocity: number
  readonly width: number
}

type PushedScreenControls = {
  readonly back: () => void
  readonly edge: EdgeHandlers
}

const ROOT_PATHNAME = '/'
const BACK_DISTANCE_SHARE = 1 / 3
const BACK_VELOCITY = 500

const PushedScreenContext = React.createContext<Option.Option<PushedScreenControls>>(Option.none())

export const commitsBack = ({ offset, velocity, width }: BackGesture): boolean =>
  offset > width * BACK_DISTANCE_SHARE || velocity > BACK_VELOCITY

const useParentPathname = (): string =>
  useParentMatches({
    select: (matches) =>
      pipe(
        Arr.last(matches),
        Option.map((parent) => parent.pathname),
        Option.getOrElse(() => ROOT_PATHNAME),
      ),
  })

const useOpener = (): void => {
  const router = useRouter()
  const [opener] = React.useState(() =>
    Option.getOrElse(
      findOpener(router.state.location.state.openerKey),
      () => document.activeElement,
    ),
  )

  React.useEffect(
    () => () => {
      restoreFocus(opener)
    },
    [opener],
  )
}

const historyIndex = ({ state: { __TSR_index: index } }: HistoryEntry): number => index

const arrivedByPush = (router: AnyRouter): boolean =>
  Option.exists(
    Option.fromUndefinedOr(router.state.resolvedLocation),
    (previous) => historyIndex(router.state.location) > historyIndex(previous),
  )

const useLandedIndex = (): number | undefined =>
  useRouterState({
    select: (state) =>
      state.resolvedLocation === undefined ? undefined : historyIndex(state.resolvedLocation),
  })

export const usePushedScreen = (): PushedScreenControls =>
  Option.getOrThrowWith(
    React.useContext(PushedScreenContext),
    () => new Error('usePushedScreen needs a PushedScreen above it.'),
  )

export function PushedScreen({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const parentPathname = useParentPathname()
  const covered = useCoveredByPushedScreen()
  const width = useColumnWidth()
  const reduce = useReducedMotion() ?? false
  const shellReady = useShellReady()
  const landedIndex = useLandedIndex()
  const keyboardFit = useKeyboardFit()
  const [slidesIn] = React.useState(() => shellReady.current && !reduce && arrivedByPush(router))
  const [leftFrom, setLeftFrom] = React.useState<Option.Option<number>>(Option.none())
  const offsetX = useMotionValue(slidesIn ? width : 0)
  const screen = React.useRef<HTMLDivElement>(null)
  const arrived = React.useRef(false)
  const dragOrigin = React.useRef<Option.Option<number>>(Option.none())
  const edgeLock = useAxisLock()
  const landedOnAnotherEntry = Option.exists(
    leftFrom,
    (index) => landedIndex !== undefined && landedIndex < index,
  )
  const leaving = Option.isSome(leftFrom) && !landedOnAnotherEntry

  useOpener()

  const arrive = () => {
    arrived.current = true
    focusScreenTitle(screen.current)
  }

  React.useEffect(() => {
    if (!slidesIn) {
      arrive()

      return undefined
    }

    const controls = animate(offsetX, 0, { ...GLIDE, onComplete: arrive })

    return () => {
      controls.stop()
    }
  }, [slidesIn, offsetX])

  React.useEffect(() => {
    if (landedOnAnotherEntry) {
      setLeftFrom(Option.none())
      offsetX.jump(0)
      arrive()
    }
  }, [landedOnAnotherEntry, offsetX])

  const leave = () => {
    if (router.history.canGoBack()) {
      router.history.back()

      return
    }

    void router.navigate({ to: parentPathname, replace: true })
  }

  const back = () => {
    if (leaving) {
      return
    }

    if (router.state.status === 'pending') {
      offsetX.jump(0)
      leave()

      return
    }

    setLeftFrom(Option.some(historyIndex(router.state.location)))

    if (reduce) {
      leave()

      return
    }

    animate(offsetX, width, { ...GLIDE, onComplete: leave })
  }

  const release = () => {
    if (Option.isNone(dragOrigin.current)) {
      return
    }

    dragOrigin.current = Option.none()
    const swiped = Option.contains(edgeLock.release(), 'x')

    if (swiped && commitsBack({ offset: offsetX.get(), velocity: offsetX.getVelocity(), width })) {
      back()

      return
    }

    if (reduce) {
      offsetX.jump(0)

      return
    }

    animate(offsetX, 0, GLIDE)
  }

  const edge: EdgeHandlers = {
    onPointerDown: (event) => {
      offsetX.stop()

      if (!arrived.current) {
        arrive()
      }

      event.currentTarget.setPointerCapture(event.pointerId)
      dragOrigin.current = Option.some(event.clientX - offsetX.get())
      edgeLock.begin(event)
    },
    onPointerMove: (event) => {
      if (Option.isSome(dragOrigin.current) && Option.contains(edgeLock.follow(event), 'x')) {
        offsetX.set(Math.max(0, event.clientX - dragOrigin.current.value))
      }
    },
    onPointerUp: release,
    onPointerCancel: release,
  }

  return (
    <motion.div
      ref={screen}
      data-slot="pushed-screen"
      inert={covered || leaving}
      data-keyboard={Option.isSome(keyboardFit) ? 'open' : undefined}
      className="bg-background fixed inset-y-0 z-30 flex flex-col shadow-[-8px_0_24px_-12px_rgb(0_0_0/0.25)]"
      style={{ ...COLUMN_STYLE, ...keyboardFitStyle(keyboardFit), x: offsetX }}
    >
      <PushedScreenContext value={Option.some({ back, edge })}>
        <EdgeBack />
        {children}
      </PushedScreenContext>
    </motion.div>
  )
}

function EdgeBack() {
  const { edge } = usePushedScreen()

  return (
    <div
      aria-hidden="true"
      data-slot="edge-back"
      className="absolute inset-y-0 left-0 z-5 w-4 touch-none"
      {...edge}
    />
  )
}

export function BackButton({ label }: { label: string }) {
  const { back } = usePushedScreen()

  return (
    <Button variant="ghost" size="icon-touch" aria-label={label} onClick={back}>
      <ChevronLeft className="size-6" />
    </Button>
  )
}

export function PushedHeader({
  title,
  subtitle,
  backLabel,
  trailing,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  backLabel: string
  trailing?: React.ReactNode
}) {
  return (
    <header className="border-border bg-background/90 relative z-10 border-b pt-[var(--safe-top)] backdrop-blur">
      <HeaderBanner />
      <div className="flex items-center gap-1 px-1">
        <BackButton label={backLabel} />
        <div className="min-w-0 flex-1 py-1.5">
          <h1
            data-screen-title
            tabIndex={-1}
            className="font-display truncate text-xl leading-7 font-semibold tracking-[-0.015em] outline-none"
          >
            {title}
          </h1>
          {subtitle === undefined ? null : (
            <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs leading-4">
              {subtitle}
            </div>
          )}
        </div>
        {trailing}
      </div>
    </header>
  )
}
