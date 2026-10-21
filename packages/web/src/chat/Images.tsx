import { Dialog } from '@base-ui/react/dialog'
import { cn } from 'cn'
import * as Base64 from 'effect/encoding/Base64'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import { X } from 'lucide-react'
import { animate, AnimatePresence, mix, motion, useIsPresent, useReducedMotion } from 'motion/react'
import type { AnimationPlaybackControls } from 'motion/react'
import * as React from 'react'

import type { ImageBlock } from '@crook/domain/TranscriptMessage'
import { Button } from '@crook/web/components/ui/button'
import { MOVE_SLOP } from '@crook/web/components/press/PressGesture'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { GLIDE } from '@crook/web/motion/Springs'
import { scale as scaleTo } from '@crook/web/motion/TransformString'

type ThumbPlace = 'tool' | 'message'

type View = {
  readonly scale: number
  readonly shiftX: number
  readonly shiftY: number
  readonly drop: number
}

type Point = { readonly left: number; readonly top: number }

type Sample = { readonly top: number; readonly at: number }

type Pan = {
  readonly kind: 'pan'
  readonly origin: Point
  readonly start: View
  readonly afterPinch: boolean
  moved: boolean
  readonly samples: Sample[]
}

type Pinch = {
  readonly kind: 'pinch'
  readonly distance: number
  readonly mid: Point
  readonly start: View
}

type Gesture = Pan | Pinch

export type Picture = { readonly image: ImageBlock; readonly name: string }

type Opened = { readonly picture: Picture; readonly url: string; readonly opener: HTMLElement }

type Frame = { readonly stage: HTMLElement | null; readonly shown: HTMLElement | null }

const MAX_ZOOM = 4
const DOUBLE_TAP_ZOOM = 2.5
const DOUBLE_TAP_MS = 300
const DISMISS_DISTANCE = 96
const DISMISS_VELOCITY = 500
const FADE_DISTANCE = 320
const VELOCITY_WINDOW_MS = 80
const MIN_FLICK_DISTANCE = 24
const MILLISECONDS_PER_SECOND = 1000
const ENTER_SCALE = 0.96
const CLOSE_ICON_CLASS = 'size-6'
const THUMB_HEIGHT = { tool: 96, message: 160 } satisfies Record<ThumbPlace, number>
const REST: View = { scale: 1, shiftX: 0, shiftY: 0, drop: 0 }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const distanceBetween = (first: Point, second: Point) =>
  Math.hypot(first.left - second.left, first.top - second.top)

const midpoint = (first: Point, second: Point): Point => ({
  left: (first.left + second.left) / 2,
  top: (first.top + second.top) / 2,
})

const pointOf = (event: React.PointerEvent): Point => ({ left: event.clientX, top: event.clientY })

const releaseVelocity = (samples: readonly Sample[]): number => {
  const now = performance.now()
  const recent = samples.filter((sample) => now - sample.at <= VELOCITY_WINDOW_MS)
  const first = recent.at(0)
  const last = recent.at(-1)

  if (first === undefined || last === undefined || last.at === first.at) {
    return 0
  }

  return ((last.top - first.top) / (last.at - first.at)) * MILLISECONDS_PER_SECOND
}

const isDismissal = (drop: number, samples: readonly Sample[]): boolean => {
  const velocity = releaseVelocity(samples)
  const flicked =
    Math.abs(velocity) > DISMISS_VELOCITY &&
    Math.abs(drop) > MIN_FLICK_DISTANCE &&
    Math.sign(velocity) === Math.sign(drop)

  return Math.abs(drop) > DISMISS_DISTANCE || flicked
}

const relativeTo = (stage: HTMLElement | null, point: Point): Point => {
  const rect = stage?.getBoundingClientRect()

  return rect === undefined
    ? point
    : { left: point.left - rect.left - rect.width / 2, top: point.top - rect.top - rect.height / 2 }
}

const fitWithin = ({ stage, shown }: Frame, next: View): View => {
  if (stage === null || shown === null) {
    return next
  }

  const spareX = Math.max(0, (shown.offsetWidth * next.scale - stage.clientWidth) / 2)
  const spareY = Math.max(0, (shown.offsetHeight * next.scale - stage.clientHeight) / 2)

  return {
    ...next,
    shiftX: clamp(next.shiftX, -spareX, spareX),
    shiftY: clamp(next.shiftY, -spareY, spareY),
  }
}

const pairOf = (pointers: ReadonlyMap<number, Point>): Option.Option<readonly [Point, Point]> => {
  const [first, second] = [...pointers.values()]

  return first === undefined || second === undefined ? Option.none() : Option.some([first, second])
}

const zoomedAt = (frame: Frame, point: Point): View => {
  const spot = relativeTo(frame.stage, point)

  return fitWithin(frame, {
    scale: DOUBLE_TAP_ZOOM,
    shiftX: -spot.left * (DOUBLE_TAP_ZOOM - 1),
    shiftY: -spot.top * (DOUBLE_TAP_ZOOM - 1),
    drop: 0,
  })
}

const pinchedView = (
  frame: Frame,
  current: Pinch,
  [first, second]: readonly [Point, Point],
): View => {
  const scale = clamp(
    (current.start.scale * distanceBetween(first, second)) / current.distance,
    1,
    MAX_ZOOM,
  )
  const mid = relativeTo(frame.stage, midpoint(first, second))
  const ratio = scale / current.start.scale

  return fitWithin(frame, {
    scale,
    shiftX: mid.left - (current.mid.left - current.start.shiftX) * ratio,
    shiftY: mid.top - (current.mid.top - current.start.shiftY) * ratio,
    drop: 0,
  })
}

const pannedView = (frame: Frame, current: Pan, point: Point): View => {
  const deltaX = point.left - current.origin.left
  const deltaY = point.top - current.origin.top

  return current.afterPinch || current.start.scale > 1
    ? fitWithin(frame, {
        ...current.start,
        shiftX: current.start.shiftX + deltaX,
        shiftY: current.start.shiftY + deltaY,
      })
    : { ...REST, drop: deltaY }
}

const paintView = (
  { scale, shiftX, shiftY, drop }: View,
  shown: HTMLElement | null,
  backdrop: HTMLElement | null,
) => {
  if (shown !== null) {
    shown.style.transform = `translate3d(${shiftX}px, ${shiftY + drop}px, 0) scale(${scale})`
  }

  if (backdrop !== null) {
    backdrop.style.opacity = String(1 - Math.min(1, Math.abs(drop) / FADE_DISTANCE))
  }
}

const objectUrlOf = (image: ImageBlock): Option.Option<string> =>
  Result.match(Base64.decode(image.data), {
    onFailure: () => Option.none(),
    onSuccess: (bytes) =>
      Option.some(
        URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: image.mediaType })),
      ),
  })

const focusQuietly = (element: HTMLElement | null): boolean => {
  element?.focus({ preventScroll: true, focusVisible: false })

  return false
}

export const useObjectUrl = (image: ImageBlock): Option.Option<string> => {
  const [url, setUrl] = React.useState<Option.Option<string>>(Option.none())

  React.useEffect(() => {
    const made = objectUrlOf(image)

    setUrl(made)

    return () => {
      Option.map(made, (href) => {
        URL.revokeObjectURL(href)
      })
    }
  }, [image])

  return url
}

function useZoom(onDismiss: () => void) {
  const stage = React.useRef<HTMLDivElement>(null)
  const picture = React.useRef<HTMLImageElement>(null)
  const backdrop = React.useRef<HTMLDivElement>(null)
  const view = React.useRef<View>(REST)
  const pointers = React.useRef(new Map<number, Point>())
  const gesture = React.useRef<Option.Option<Gesture>>(Option.none())
  const lastTap = React.useRef(0)
  const settling = React.useRef<Option.Option<AnimationPlaybackControls>>(Option.none())
  const reduce = useReducedMotion() ?? false

  const frame = (): Frame => ({ stage: stage.current, shown: picture.current })

  const show = (next: View) => {
    view.current = next
    paintView(next, picture.current, backdrop.current)
  }

  const stopSettling = () => {
    Option.map(settling.current, (controls) => {
      controls.stop()
    })
  }

  const settle = (target: View) => {
    stopSettling()

    if (reduce) {
      show(target)

      return
    }

    const between = mix(view.current, target)

    settling.current = Option.some(
      animate(0, 1, {
        ...GLIDE,
        onUpdate: (progress) => {
          show(between(progress))
        },
      }),
    )
  }

  const beginPan = (point: Point, afterPinch: boolean) => {
    gesture.current = Option.some({
      kind: 'pan',
      origin: point,
      start: view.current,
      afterPinch,
      moved: false,
      samples: [{ top: point.top, at: performance.now() }],
    })
  }

  const settleInBounds = () => {
    settle(view.current.scale <= 1 ? REST : fitWithin(frame(), { ...view.current, drop: 0 }))
  }

  const onTap = (point: Point) => {
    const at = performance.now()

    if (at - lastTap.current > DOUBLE_TAP_MS) {
      lastTap.current = at

      return
    }

    lastTap.current = 0
    settle(view.current.scale > 1 ? REST : zoomedAt(frame(), point))
  }

  const movePan = (current: Pan, point: Point) => {
    if (distanceBetween(point, current.origin) > MOVE_SLOP) {
      current.moved = true
    }

    current.samples.push({ top: point.top, at: performance.now() })
    show(pannedView(frame(), current, point))
  }

  const releasePan = (current: Pan, released: Point) => {
    if (current.afterPinch) {
      settleInBounds()

      return
    }

    if (!current.moved) {
      onTap(released)

      return
    }

    if (current.start.scale > 1) {
      return
    }

    if (isDismissal(view.current.drop, current.samples)) {
      onDismiss()

      return
    }

    settle(REST)
  }

  const onPointerDown = (event: React.PointerEvent) => {
    stopSettling()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, pointOf(event))
    Option.match(pairOf(pointers.current), {
      onSome: ([first, second]) => {
        gesture.current = Option.some({
          kind: 'pinch',
          distance: distanceBetween(first, second),
          mid: relativeTo(stage.current, midpoint(first, second)),
          start: view.current,
        })
      },
      onNone: () => {
        beginPan(pointOf(event), false)
      },
    })
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) {
      return
    }

    pointers.current.set(event.pointerId, pointOf(event))
    Option.map(gesture.current, (current) => {
      if (current.kind === 'pinch') {
        Option.map(pairOf(pointers.current), (pair) => {
          show(pinchedView(frame(), current, pair))
        })

        return
      }

      movePan(current, pointOf(event))
    })
  }

  const onPointerUp = (event: React.PointerEvent) => {
    const released = pointers.current.get(event.pointerId)
    const current = gesture.current
    const [remaining] = [...pointers.current.values()].filter((point) => point !== released)

    pointers.current.delete(event.pointerId)

    if (remaining !== undefined) {
      beginPan(
        remaining,
        Option.exists(current, (found) => found.kind === 'pinch' || found.afterPinch),
      )

      return
    }

    gesture.current = Option.none()
    Option.map(
      Option.all({ found: current, point: Option.fromUndefinedOr(released) }),
      ({ found, point }) => {
        if (found.kind === 'pinch') {
          settleInBounds()

          return
        }

        releasePan(found, point)
      },
    )
  }

  const onPointerCancel = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)

    if (pointers.current.size === 0) {
      gesture.current = Option.none()
      settleInBounds()
    }
  }

  return {
    stage,
    picture,
    backdrop,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  }
}

function ViewerLayer({ opened, onClose }: { opened: Opened; onClose: () => void }) {
  const present = useIsPresent()
  const close = React.useRef<HTMLButtonElement>(null)
  const zoom = useZoom(onClose)
  const reduce = useReducedMotion() ?? false

  return (
    <Dialog.Portal keepMounted>
      <Dialog.Popup
        initialFocus={(type) => type === 'keyboard' || focusQuietly(close.current)}
        finalFocus={(type) =>
          type === 'keyboard' || focusQuietly(opened.opener.isConnected ? opened.opener : null)
        }
        render={
          <motion.div
            className={cn(
              'fixed inset-0 z-50 text-white outline-none',
              !present && 'pointer-events-none',
            )}
            inert={!present}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTokens().fade}
          />
        }
      >
        <div ref={zoom.backdrop} className="absolute inset-0 bg-black" />
        <Dialog.Title className="sr-only">{opened.picture.name}</Dialog.Title>
        <Dialog.Description className="sr-only">
          Pinch or double-tap to zoom, swipe down to close.
        </Dialog.Description>
        <div
          ref={zoom.stage}
          data-slot="image-stage"
          className="absolute inset-0 flex touch-none items-center justify-center overflow-hidden select-none"
          {...zoom.handlers}
        >
          <motion.div
            className="flex size-full items-center justify-center"
            initial={{ opacity: 0, transform: scaleTo(reduce ? 1 : ENTER_SCALE) }}
            animate={{ opacity: 1, transform: scaleTo(1) }}
            transition={motionTokens().fade}
          >
            <img
              ref={zoom.picture}
              src={opened.url}
              alt={opened.picture.name}
              draggable={false}
              className="max-h-full max-w-full object-contain will-change-transform [-webkit-touch-callout:none]"
            />
          </motion.div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent px-2 pt-[var(--safe-top)] pb-6">
          <span className="min-w-0 flex-1 truncate ps-3 font-mono text-xs text-white/80">
            {opened.picture.name}
          </span>
          <Dialog.Close
            render={
              <Button
                ref={close}
                variant="ghost"
                size="icon-touch"
                aria-label="Close image"
                className="pointer-events-auto text-white hover:bg-white/15 hover:text-white"
              >
                <X className={CLOSE_ICON_CLASS} />
              </Button>
            }
          />
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  )
}

function Thumb({
  picture,
  height,
  onOpen,
}: {
  picture: Picture
  height: number
  onOpen: (url: string, opener: HTMLElement) => void
}) {
  const url = useObjectUrl(picture.image)

  return Option.match(url, {
    onNone: () => null,
    onSome: (href) => (
      <button
        type="button"
        aria-label={`View ${picture.name}`}
        className="border-border bg-muted focus-visible:ring-ring shrink-0 touch-manipulation overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
        onClick={(event) => {
          onOpen(href, event.currentTarget)
        }}
      >
        <img
          src={href}
          alt={picture.name}
          draggable={false}
          className="block w-auto max-w-[16rem] object-cover"
          style={{ height }}
        />
      </button>
    ),
  })
}

export function Thumbs({
  pictures,
  place,
  className,
}: {
  pictures: readonly Picture[]
  place: ThumbPlace
  className?: string
}) {
  const [opened, setOpened] = React.useState<Option.Option<Opened>>(Option.none())

  const close = () => {
    setOpened(Option.none())
  }

  if (pictures.length === 0) {
    return null
  }

  return (
    <>
      <div data-slot="thumbs" className={cn('no-scrollbar flex gap-2 overflow-x-auto', className)}>
        {pictures.map((picture, index) => (
          <Thumb
            key={index}
            picture={picture}
            height={THUMB_HEIGHT[place]}
            onOpen={(url, opener) => {
              setOpened(Option.some({ picture, url, opener }))
            }}
          />
        ))}
      </div>
      <Dialog.Root
        open={Option.isSome(opened)}
        onOpenChange={(next) => {
          if (!next) {
            close()
          }
        }}
      >
        <AnimatePresence>
          {Option.match(opened, {
            onNone: () => null,
            onSome: (current) => <ViewerLayer key={current.url} opened={current} onClose={close} />,
          })}
        </AnimatePresence>
      </Dialog.Root>
    </>
  )
}
