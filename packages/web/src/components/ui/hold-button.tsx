import { cn } from 'cn'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as React from 'react'

type HoldState = 'idle' | 'holding' | 'complete'

type HoldButtonProps = React.ComponentProps<'button'> & {
  disabled: boolean
  onComplete: () => void
  completeLabel: React.ReactNode
}

const HOLD_MS = 900
const COMPLETE_LABEL_MS = 1200
const PRIMARY_BUTTON = 0
const KEYBOARD_CLICK_DETAIL = 0
const PERCENT = 100

const announcement = (state: HoldState, progress: number): string =>
  ({
    idle: '',
    holding: `Confirmation ${Math.round(progress * PERCENT)} percent complete`,
    complete: 'Action complete',
  })[state]

const cancelPending = (pending: React.RefObject<Option.Option<() => void>>): void => {
  if (Option.isSome(pending.current)) {
    pending.current.value()
  }

  pending.current = Option.none()
}

export function HoldButton({
  children,
  completeLabel,
  onComplete,
  disabled,
  className,
  ...props
}: HoldButtonProps) {
  const [progress, setProgress] = React.useState(0)
  const [state, setState] = React.useState<HoldState>('idle')
  const stateRef = React.useRef<HoldState>('idle')
  const frameRef = React.useRef<Option.Option<number>>(Option.none())
  const resetRef = React.useRef<Option.Option<() => void>>(Option.none())
  const onCompleteRef = React.useRef(onComplete)

  React.useEffect(() => {
    onCompleteRef.current = onComplete
  }, [onComplete])

  const moveTo = (next: HoldState, nextProgress: number) => {
    stateRef.current = next
    setState(next)
    setProgress(nextProgress)
  }

  const clearFrame = () => {
    if (Option.isSome(frameRef.current)) {
      cancelAnimationFrame(frameRef.current.value)
    }

    frameRef.current = Option.none()
  }

  const finish = () => {
    clearFrame()
    moveTo('complete', 1)
    onCompleteRef.current()
    cancelPending(resetRef)
    resetRef.current = Option.some(
      Effect.runCallback(
        Effect.sleep(Duration.millis(COMPLETE_LABEL_MS)).pipe(
          Effect.andThen(
            Effect.sync(() => {
              resetRef.current = Option.none()
              moveTo('idle', 0)
            }),
          ),
        ),
      ),
    )
  }

  const cancel = () => {
    if (stateRef.current !== 'holding') {
      return
    }

    clearFrame()
    moveTo('idle', 0)
  }

  const cancelUnlessPrevented = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.defaultPrevented) {
      cancel()
    }
  }

  const begin = () => {
    if (disabled || stateRef.current !== 'idle') {
      return
    }

    const startedAt = performance.now()

    moveTo('holding', 0)

    const tick = (now: number) => {
      const nextProgress = Math.min((now - startedAt) / HOLD_MS, 1)

      setProgress(nextProgress)

      if (nextProgress >= 1) {
        finish()

        return
      }

      frameRef.current = Option.some(requestAnimationFrame(tick))
    }

    frameRef.current = Option.some(requestAnimationFrame(tick))
  }

  React.useEffect(
    () => () => {
      clearFrame()
      cancelPending(resetRef)
    },
    [],
  )

  return (
    <button
      {...props}
      data-slot="hold-button"
      data-state={state}
      type="button"
      disabled={disabled}
      onPointerDown={(event) => {
        if (event.defaultPrevented || event.button !== PRIMARY_BUTTON) {
          return
        }

        event.currentTarget.setPointerCapture(event.pointerId)
        begin()
      }}
      onPointerUp={cancelUnlessPrevented}
      onPointerCancel={cancelUnlessPrevented}
      onLostPointerCapture={cancelUnlessPrevented}
      onClick={(event) => {
        if (
          !event.defaultPrevented &&
          event.detail === KEYBOARD_CLICK_DETAIL &&
          stateRef.current === 'idle'
        ) {
          finish()
        }
      }}
      className={cn(
        'border-destructive/30 bg-destructive text-destructive-foreground focus-visible:ring-ring/35 relative isolate inline-flex min-h-11 min-w-44 cursor-default items-center justify-center overflow-hidden rounded-[var(--radius)] border px-5 py-2.5 text-sm font-semibold shadow-sm outline-none select-none focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50 data-[state=holding]:scale-[0.98] motion-safe:transition-transform motion-safe:duration-150',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="bg-foreground/25 absolute inset-0 -z-10 origin-left"
        style={{ transform: `scaleX(${progress})` }}
      />
      <span>{state === 'complete' ? completeLabel : children}</span>
      <span className="sr-only" aria-live="polite">
        {announcement(state, progress)}
      </span>
    </button>
  )
}
