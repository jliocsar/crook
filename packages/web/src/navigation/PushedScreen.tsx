import { useLocation, useParentMatches, useRouter } from '@tanstack/react-router'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import { ChevronLeft } from 'lucide-react'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import * as React from 'react'

import { Button } from '@crook/web/components/ui/button'
import { GLIDE } from '@crook/web/motion/Springs'
import { commitsBack } from '@crook/web/navigation/BackGesture'
import { COLUMN_STYLE, useColumnWidth } from '@crook/web/navigation/Column'
import { focusScreenTitle, restoreFocus } from '@crook/web/navigation/Focus'
import { findOpener, forgetOpener } from '@crook/web/navigation/Opener'
import { useCoveredByPushedScreen } from '@crook/web/navigation/Pushed'
import { useShellReady } from '@crook/web/navigation/ShellReady'

type EdgeHandlers = Pick<
  React.DOMAttributes<HTMLDivElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
>

type PushedScreenControls = {
  readonly back: () => void
  readonly edge: EdgeHandlers
}

const ROOT_PATHNAME = '/'

const PushedScreenContext = React.createContext<Option.Option<PushedScreenControls>>(Option.none())

const useParentPathname = (): string =>
  useParentMatches({
    select: (matches) =>
      pipe(
        Arr.last(matches),
        Option.map((parent) => parent.pathname),
        Option.getOrElse(() => ROOT_PATHNAME),
      ),
  })

const useOpener = (): Element | null => {
  const openerKey = useLocation({ select: (location) => location.state.openerKey })
  const [opener] = React.useState(() =>
    Option.getOrElse(findOpener(openerKey), () => document.activeElement),
  )

  React.useEffect(
    () => () => {
      forgetOpener(openerKey)
      restoreFocus(opener)
    },
    [openerKey, opener],
  )

  return opener
}

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
  const [slidesIn] = React.useState(() => shellReady.current && !reduce)
  const [leaving, setLeaving] = React.useState(false)
  const offsetX = useMotionValue(slidesIn ? width : 0)
  const screen = React.useRef<HTMLDivElement>(null)
  const dragOrigin = React.useRef<Option.Option<number>>(Option.none())

  useOpener()

  React.useEffect(() => {
    if (!slidesIn) {
      focusScreenTitle(screen.current)

      return undefined
    }

    const controls = animate(offsetX, 0, {
      ...GLIDE,
      onComplete: () => {
        focusScreenTitle(screen.current)
      },
    })

    return () => {
      controls.stop()
    }
  }, [slidesIn, offsetX])

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

    setLeaving(true)

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

    if (commitsBack({ offset: offsetX.get(), velocity: offsetX.getVelocity(), width })) {
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
      event.currentTarget.setPointerCapture(event.pointerId)
      dragOrigin.current = Option.some(event.clientX - offsetX.get())
    },
    onPointerMove: (event) => {
      if (Option.isSome(dragOrigin.current)) {
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
      className="bg-background fixed inset-y-0 z-30 flex flex-col shadow-[-8px_0_24px_-12px_rgb(0_0_0/0.25)]"
      style={{ ...COLUMN_STYLE, x: offsetX }}
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
