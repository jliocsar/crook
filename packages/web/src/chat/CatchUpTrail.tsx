import { cn } from 'cn'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import { Laptop } from 'lucide-react'
import { animate, motion, useReducedMotion, useSpring } from 'motion/react'
import type { AnimationPlaybackControls } from 'motion/react'
import * as React from 'react'

import { CatchUp, landedOf, lapseLabel, nextCatchUp, releasedRows } from '@crook/web/chat/CatchUp'
import type { Lapse } from '@crook/web/chat/CatchUp'
import { hookPath, hookShape, LINE_X, pointAlong, ridePath } from '@crook/web/chat/HookPath'
import type { HookGeometry } from '@crook/web/chat/HookPath'
import { ROW_GAP } from '@crook/web/chat/Thread'
import type { ThreadLayout, ThreadRow } from '@crook/web/chat/Thread'
import type { TranscriptView } from '@crook/web/chat/TranscriptState'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { GLIDE, SPRING } from '@crook/web/motion/Springs'

interface Carrier {
  wrapper: HTMLDivElement | null
  chip: HTMLSpanElement | null
  pill: HTMLSpanElement | null
}

interface TrailProps {
  readonly layout: ThreadLayout
  readonly released: readonly string[]
  readonly settled: boolean
  readonly finished: boolean
  readonly lapse: Option.Option<Lapse>
  readonly pillWidth: () => number
  readonly onFinished: () => void
}

const CATCH_UP_KEY = 'catch-up'
const RELEASE_STEP_MS = 170
const FIRST_RELEASE_MS = 60
const SETTLE_AFTER_MS = 700
const MOST_STEPPED_ROWS = 22
const DIVIDER_HEIGHT = 28
const LINE_INSET = 4
const HALO = 8
const CHIP_DROP = 4
const HEAD_GAP = 8
const MORPH_RUN = 56
const MORPH_RATE = 1.6
const PILL_DELAY = 0.6
const PILL_START_SCALE = 0.9
const CHIP_START_SCALE = 0.6
const DASH_SLACK = 100
const SETTLE_EPSILON = 0.5
const CHIP_X = LINE_X - 1
const RIDE_SPRING = { duration: SPRING.duration, bounce: SPRING.bounce }

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value))

const place = (carrier: Carrier, left: number, top: number, morph: number): void => {
  if (carrier.wrapper === null || carrier.chip === null || carrier.pill === null) {
    return
  }

  const grown = clampUnit(morph * MORPH_RATE - PILL_DELAY)

  carrier.wrapper.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  carrier.chip.style.opacity = String(1 - clampUnit(morph * MORPH_RATE))
  carrier.pill.style.opacity = String(grown)
  carrier.pill.style.transform =
    grown >= 1 ? 'none' : `scale(${PILL_START_SCALE + (1 - PILL_START_SCALE) * grown})`
}

const drawnTo = (shape: HookGeometry, ridden: number, corner: number, run: number): number => {
  const turned = shape.vertical + shape.arc
  const start = Math.min(ridden, shape.total)

  return corner < 1 ? start + corner * (turned - start) : turned + run * (shape.total - turned)
}

const firstStart = (layout: ThreadLayout, keys: readonly string[]): Option.Option<number> =>
  Arr.findFirst(keys, (key) => layout.startOf(key))

const useRelease = (count: number, instant: boolean): number => {
  const [released, setReleased] = React.useState(0)
  const start = Math.max(0, count - MOST_STEPPED_ROWS)
  const shown = instant ? count : Math.max(released, start)

  React.useEffect(() => {
    if (shown >= count) {
      return undefined
    }

    const timer = window.setTimeout(
      () => {
        setReleased(shown + 1)
      },
      shown === start ? FIRST_RELEASE_MS : RELEASE_STEP_MS,
    )

    return () => {
      window.clearTimeout(timer)
    }
  }, [shown, count, start])

  return shown
}

const useHeldAfter = (flag: boolean, milliseconds: number): boolean => {
  const [held, setHeld] = React.useState(false)

  React.useEffect(() => {
    if (!flag || held) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setHeld(true)
    }, milliseconds)

    return () => {
      window.clearTimeout(timer)
    }
  }, [flag, held, milliseconds])

  return held
}

function Dots({ still }: { still: boolean }) {
  return (
    <span aria-hidden="true" className="ms-0.5 inline-flex items-center gap-[3px]">
      {Arr.map(
        ['[animation-delay:0ms]', '[animation-delay:150ms]', '[animation-delay:300ms]'],
        (delay) => (
          <span
            key={delay}
            className={cn(
              'size-[3px] rounded-full bg-current motion-reduce:animate-none',
              still ? 'opacity-70' : `animate-hop ${delay}`,
            )}
          />
        ),
      )}
    </span>
  )
}

function LaptopPill({
  lapse,
  className,
  ref,
}: {
  lapse: Option.Option<Lapse>
  className?: string
  ref?: React.Ref<HTMLSpanElement>
}) {
  return (
    <span
      ref={ref}
      className={cn(
        'border-primary/25 bg-background text-muted-foreground inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs whitespace-nowrap',
        className,
      )}
    >
      <Laptop aria-hidden="true" className="text-primary size-3.5" />
      <span className="text-foreground font-semibold">On laptop</span>
      {Option.match(lapse, {
        onNone: () => null,
        onSome: (found) => (
          <>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-[11px] tabular-nums">{lapseLabel(found)}</span>
          </>
        ),
      })}
    </span>
  )
}

function CatchUpDivider({
  lapse,
  shown,
  pillRef,
}: {
  lapse: Option.Option<Lapse>
  shown: boolean
  pillRef: React.Ref<HTMLSpanElement>
}) {
  return (
    <div
      data-slot="catch-up-divider"
      className="flex items-center justify-center"
      style={{ height: DIVIDER_HEIGHT }}
    >
      <LaptopPill ref={pillRef} lapse={lapse} className={cn(!shown && 'invisible')} />
    </div>
  )
}

function CarriedChip({
  carrier,
  done,
  lapse,
}: {
  carrier: React.RefObject<Carrier>
  done: boolean
  lapse: Option.Option<Lapse>
}) {
  return (
    <div
      ref={(node) => {
        carrier.current.wrapper = node
      }}
      aria-hidden="true"
      data-slot="catch-up-chip"
      className="pointer-events-none absolute top-0 left-0 z-10"
      style={{ height: DIVIDER_HEIGHT }}
    >
      <motion.div
        className="grid h-full items-center"
        initial={{ opacity: 0, transform: `scale(${CHIP_START_SCALE})` }}
        animate={{ opacity: 1, transform: 'scale(1)' }}
        style={{ transformOrigin: '0% 50%' }}
        transition={{ ...SPRING, opacity: motionTokens().fade }}
      >
        <span
          ref={(node) => {
            carrier.current.chip = node
          }}
          className="bg-primary text-primary-foreground inline-flex h-6 items-center gap-1 justify-self-start rounded-[3px_12px_12px_12px] px-2 text-[11px] font-semibold whitespace-nowrap shadow-sm [grid-area:1/1]"
        >
          <Laptop aria-hidden="true" className="size-3" />
          laptop
          <Dots still={done} />
        </span>
        <span
          ref={(node) => {
            carrier.current.pill = node
          }}
          className="justify-self-start opacity-0 [grid-area:1/1]"
          style={{ transformOrigin: '0% 50%' }}
        >
          <LaptopPill lapse={lapse} />
        </span>
      </motion.div>
    </div>
  )
}

function CatchUpTrail({
  layout,
  released,
  settled,
  finished,
  lapse,
  pillWidth,
  onFinished,
}: TrailProps) {
  const path = React.useRef<SVGPathElement>(null)
  const carrier = React.useRef<Carrier>({ wrapper: null, chip: null, pill: null })
  const bottom = useSpring(0, RIDE_SPRING)
  const placed = React.useRef(false)
  const target = React.useRef(0)
  const ridden = React.useRef(0)
  const corner = React.useRef(0)
  const run = React.useRef(0)
  const latest = React.useRef({ layout, released, settled, finished })

  const draw = React.useCallback(() => {
    const line = path.current
    const now = latest.current
    const marker = now.layout.startOf(CATCH_UP_KEY)

    if (line === null || Option.isNone(marker)) {
      return
    }

    const rowsEnd = marker.value - ROW_GAP
    const top = Option.map(firstStart(now.layout, now.released), (start) =>
      Math.round(start + LINE_INSET),
    )

    if (!placed.current) {
      bottom.jump(rowsEnd)
      target.current = rowsEnd
      placed.current = true
    } else if (Math.abs(target.current - rowsEnd) > SETTLE_EPSILON) {
      target.current = rowsEnd
      bottom.set(rowsEnd)
    }

    if (!now.settled || Option.isNone(top)) {
      const { y0, length } = Option.match(top, {
        onNone: () => ({ y0: rowsEnd, length: 0 }),
        onSome: (start) => ({
          y0: start,
          length: Math.max(0, Math.round(bottom.get() - LINE_INSET) - start),
        }),
      })

      ridden.current = length
      line.setAttribute('d', ridePath(y0, length))
      line.style.strokeDasharray = 'none'
      line.style.opacity = length < 1 ? '0' : '1'
      place(carrier.current, CHIP_X, bottom.get() + CHIP_DROP, 0)

      return
    }

    const yc = Math.round(marker.value + DIVIDER_HEIGHT / 2)
    const pillLeft = (now.layout.width() - pillWidth()) / 2
    const shape = hookShape(top.value, yc, Math.round(pillLeft - HALO))
    const endAt = now.finished
      ? shape.total
      : drawnTo(shape, ridden.current, corner.current, run.current)
    const head = pointAlong(shape, endAt)
    const below = { left: CHIP_X, top: head.top + HEAD_GAP }
    const beside = { left: Math.min(head.left + HALO, pillLeft), top: yc - DIVIDER_HEIGHT / 2 }

    line.setAttribute('d', hookPath(shape))
    line.style.strokeDasharray = `${endAt} ${shape.total + DASH_SLACK}`
    line.style.opacity = '1'
    place(
      carrier.current,
      below.left + (beside.left - below.left) * head.turn,
      below.top + (beside.top - below.top) * head.turn,
      clampUnit((endAt - shape.vertical) / (shape.arc + MORPH_RUN)),
    )
  }, [bottom, pillWidth])

  React.useLayoutEffect(() => {
    latest.current = { layout, released, settled, finished }
    draw()
  })

  React.useEffect(() => {
    if (finished) {
      return undefined
    }

    let frame = 0

    const tick = () => {
      draw()
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [finished, draw])

  React.useEffect(() => {
    if (!settled || finished) {
      return undefined
    }

    const controls: AnimationPlaybackControls[] = [
      animate(0, 1, {
        ...motionTokens().slow,
        onUpdate: (value) => {
          corner.current = value
        },
        onComplete: () => {
          controls.push(
            animate(0, 1, {
              ...GLIDE,
              onUpdate: (value) => {
                run.current = value
              },
              onComplete: onFinished,
            }),
          )
        },
      }),
    ]

    return () => {
      Arr.forEach(controls, (control) => {
        control.stop()
      })
    }
  }, [settled, finished, onFinished])

  return (
    <>
      <svg
        aria-hidden="true"
        data-slot="catch-up-trail"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        <path
          ref={path}
          fill="none"
          stroke="var(--primary)"
          strokeOpacity={0.45}
          strokeWidth={2}
          strokeLinecap="round"
          style={{ opacity: 0 }}
        />
      </svg>
      {finished ? null : <CarriedChip carrier={carrier} done={settled} lapse={lapse} />}
    </>
  )
}

export function useCatchUp(view: Option.Option<TranscriptView>, rows: readonly ThreadRow[]) {
  const reduce = useReducedMotion() ?? false
  const [phase, setPhase] = React.useState<CatchUp>(() => CatchUp.Waiting())
  const next = nextCatchUp(phase, view, rows)

  if (next !== phase) {
    setPhase(next)
  }

  const landed = React.useMemo(() => landedOf(next), [next])
  const count = Option.match(landed, { onNone: () => 0, onSome: (found) => found.keys.length })
  const shown = useRelease(count, reduce)
  const done = count > 0 && shown >= count
  const held = useHeldAfter(done && !reduce, SETTLE_AFTER_MS)
  const settled = done && (reduce || held)
  const [animated, setAnimated] = React.useState(false)
  const finished = settled && (reduce || animated)
  const pill = React.useRef<HTMLSpanElement>(null)
  const lastPillWidth = React.useRef(0)
  const pillWidth = React.useCallback(() => {
    if (pill.current !== null) {
      lastPillWidth.current = pill.current.offsetWidth
    }

    return lastPillWidth.current
  }, [])
  const onFinished = React.useCallback(() => {
    setAnimated(true)
  }, [])
  const released = React.useMemo(
    () =>
      Option.match(landed, {
        onNone: () => [],
        onSome: (found) => found.keys.slice(0, shown),
      }),
    [landed, shown],
  )
  const shownRows = React.useMemo(
    () =>
      Option.match(landed, {
        onNone: () => rows,
        onSome: (found) =>
          releasedRows(rows, found.keys, shown, {
            key: CATCH_UP_KEY,
            content: <CatchUpDivider lapse={found.lapse} shown={finished} pillRef={pill} />,
          }),
      }),
    [rows, landed, shown, finished],
  )
  const overlay = React.useMemo(
    () =>
      Option.getOrUndefined(
        Option.map(
          landed,
          (found) =>
            function renderTrail(layout: ThreadLayout) {
              return (
                <CatchUpTrail
                  layout={layout}
                  released={released}
                  settled={settled}
                  finished={finished}
                  lapse={found.lapse}
                  pillWidth={pillWidth}
                  onFinished={onFinished}
                />
              )
            },
        ),
      ),
    [landed, released, settled, finished, pillWidth, onFinished],
  )

  return { rows: shownRows, overlay }
}
