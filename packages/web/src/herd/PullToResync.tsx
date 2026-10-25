import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { animate, useReducedMotion } from 'motion/react'
import type { AnimationPlaybackControls } from 'motion/react'
import * as React from 'react'

import type { Point } from '@crook/web/components/press/PressGesture'
import { useAxisLock } from '@crook/web/components/swipe/AxisLock'
import { Spinner } from '@crook/web/components/ui/spinner'
import { SPRING } from '@crook/web/motion/Springs'
import { translate } from '@crook/web/motion/TransformString'
import { TAB_SCROLLER_SELECTOR } from '@crook/web/navigation/TabScreen'

const PULL_ARMS_AT = 48
const PULL_RESTS_AT = 40
const PULL_STOPS_AT = 96
const PULL_RESISTANCE = 0.5

const pullOffset = (dragged: number): number =>
  dragged <= 0 ? 0 : Math.min(PULL_STOPS_AT, dragged * PULL_RESISTANCE)

const firstTouch = (event: React.TouchEvent): Option.Option<Point> =>
  Option.fromUndefinedOr(event.touches[0])

export function PullToResync({
  enabled,
  onResync,
  children,
}: {
  enabled: boolean
  onResync: () => Promise<void>
  children: React.ReactNode
}) {
  const zone = React.useRef<HTMLDivElement>(null)
  const content = React.useRef<HTMLDivElement>(null)
  const spinner = React.useRef<HTMLDivElement>(null)
  const start = React.useRef<Option.Option<number>>(Option.none())
  const pull = useAxisLock()
  const offset = React.useRef(0)
  const syncing = React.useRef(false)
  const settling = React.useRef<Option.Option<AnimationPlaybackControls>>(Option.none())
  const reduce = useReducedMotion() ?? false

  const show = (next: number) => {
    offset.current = next

    if (content.current) {
      content.current.style.transform = next === 0 ? '' : translate('Y', next)
    }

    if (spinner.current) {
      spinner.current.style.opacity = String(Math.min(1, next / PULL_RESTS_AT))
    }
  }

  const stopSettling = () => {
    if (Option.isSome(settling.current)) {
      settling.current.value.stop()
    }

    settling.current = Option.none()
  }

  const settle = (target: number) => {
    stopSettling()

    if (reduce) {
      show(target)

      return
    }

    settling.current = Option.some(animate(offset.current, target, { ...SPRING, onUpdate: show }))
  }

  const atTop = () => (zone.current?.closest(TAB_SCROLLER_SELECTOR)?.scrollTop ?? 0) <= 0

  const release = () => {
    const pulled = Option.contains(pull.release(), 'y')

    if (Option.isNone(start.current)) {
      return
    }

    start.current = Option.none()

    if (!pulled || offset.current < PULL_ARMS_AT) {
      settle(0)

      return
    }

    syncing.current = true
    settle(PULL_RESTS_AT)
    Effect.runFork(
      Effect.promise(onResync).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            syncing.current = false
            settle(0)
          }),
        ),
      ),
    )
  }

  return (
    <div
      ref={zone}
      data-slot="pull-to-resync"
      className="relative"
      onTouchStart={(event) => {
        if (!enabled || syncing.current || !atTop()) {
          return
        }

        stopSettling()
        start.current = Option.map(firstTouch(event), (touch) => {
          pull.begin(touch)

          return touch.clientY
        })
      }}
      onTouchMove={(event) => {
        const pulling = Option.all([start.current, firstTouch(event)]).pipe(
          Option.filter(([, touch]) => Option.contains(pull.follow(touch), 'y')),
        )

        if (Option.isSome(pulling)) {
          const [origin, touch] = pulling.value

          show(pullOffset(touch.clientY - origin))
        }
      }}
      onTouchEnd={release}
      onTouchCancel={release}
    >
      <div
        ref={spinner}
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute inset-x-0 top-0 flex h-10 items-center justify-center opacity-0"
      >
        <Spinner />
      </div>
      <div ref={content}>{children}</div>
    </div>
  )
}
