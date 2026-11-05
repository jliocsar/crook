import * as Duration from 'effect/Duration'
import * as React from 'react'

import { cn } from 'cn'

import {
  INDICATOR_BEGAN,
  INDICATOR_ENDED,
  indicatorMachine,
  IndicatorState,
  indicatorTimer,
  isIndicatorShown,
} from '@crook/web/machine/IndicatorMachine'
import type { IndicatorCommand } from '@crook/web/machine/IndicatorMachine'
import { stateMark } from '@crook/web/machine/Machine'
import { useMachine } from '@crook/web/machine/UseMachine'
import { motionTokens } from '@crook/web/motion/MotionTokens'

type SpinnerProps = Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> & {
  pending?: boolean
  holdsRoom?: boolean
  idle?: React.ReactNode
  size?: number
  label?: string
}

const indicatorPerform = (command: IndicatorCommand) =>
  indicatorTimer(Duration.seconds(motionTokens().fade.duration))(command)

const useIndicator = (pending: boolean): IndicatorState => {
  const [state, dispatch] = useMachine(indicatorMachine, indicatorPerform)

  React.useEffect(() => {
    dispatch(pending ? INDICATOR_BEGAN : INDICATOR_ENDED)
  }, [pending, dispatch])

  return state
}

export function SpinnerGlyph({
  size = 16,
  label,
  className,
  ...rootProps
}: Omit<React.HTMLAttributes<HTMLSpanElement>, 'children'> & {
  size?: number
  label?: string | undefined
}) {
  return (
    <span
      data-slot="spinner"
      role={label === undefined ? undefined : 'status'}
      aria-hidden={label === undefined ? 'true' : undefined}
      className={cn('inline-flex items-center', className)}
      {...rootProps}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        aria-hidden="true"
        className="animate-spin motion-reduce:animate-none"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="2.5"
          className="opacity-20"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {label === undefined ? null : <span className="sr-only">{label}</span>}
    </span>
  )
}

export function Spinner({
  pending = true,
  holdsRoom = false,
  idle = null,
  size = 16,
  label,
  className,
  ...rootProps
}: SpinnerProps) {
  const state = useIndicator(pending)

  if (!isIndicatorShown(state)) {
    return pending && holdsRoom ? (
      <span
        data-slot="spinner-slot"
        aria-hidden="true"
        className={cn('inline-block shrink-0', className)}
        style={{ width: size, height: size }}
      />
    ) : (
      idle
    )
  }

  return (
    <SpinnerGlyph
      {...stateMark(indicatorMachine, state)}
      size={size}
      label={label}
      className={cn(
        'transition-opacity duration-(--motion) ease-(--ease-out) starting:opacity-0 motion-reduce:transition-none',
        IndicatorState.guards.Leaving(state) && 'opacity-0',
        className,
      )}
      {...rootProps}
    />
  )
}
