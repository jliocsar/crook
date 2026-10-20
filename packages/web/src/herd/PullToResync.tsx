import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { animate, useReducedMotion } from 'motion/react'
import type { AnimationPlaybackControls } from 'motion/react'
import * as React from 'react'

import { Spinner } from '@crook/web/components/ui/spinner'
import { SPRING } from '@crook/web/motion/Springs'
import { translate } from '@crook/web/motion/TransformString'
import { TAB_SCROLLER_SELECTOR } from '@crook/web/navigation/TabScreen'

export const PULL_ARMS_AT = 48
export const PULL_RESTS_AT = 40
export const PULL_STOPS_AT = 96
export const PULL_RESISTANCE = 0.5

export const pullOffset = (dragged: number): number =>
  dragged <= 0 ? 0 : Math.min(PULL_STOPS_AT, dragged * PULL_RESISTANCE)

const firstTouchY = (event: React.TouchEvent): Option.Option<number> =>
  Option.map(Option.fromUndefinedOr(event.touches[0]), (touch) => touch.clientY)

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
    Option.map(settling.current, (controls) => {
      controls.stop()
    })
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
    if (Option.isNone(start.current)) {
      return
    }

    start.current = Option.none()

    if (offset.current < PULL_ARMS_AT) {
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
        start.current = firstTouchY(event)
      }}
      onTouchMove={(event) => {
        Option.map(Option.all([start.current, firstTouchY(event)]), ([origin, touchY]) => {
          show(pullOffset(touchY - origin))
        })
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
