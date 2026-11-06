import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import type { Range, Virtualizer, VirtualItem } from '@tanstack/react-virtual'
import { cn } from 'cn'
import * as Arr from 'effect/Array'
import * as Duration from 'effect/Duration'
import { pipe } from 'effect/Function'
import * as Option from 'effect/Option'
import { ArrowDown } from 'lucide-react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'
import * as React from 'react'

import { departedKeys, heldFrom, liftFor, reachOf, withTheEnd } from '@crook/web/chat/Reveal'
import type { LiftReach } from '@crook/web/chat/Reveal'
import { Dimmed } from '@crook/web/components/Dimmed'
import { RenderCacheScope } from '@crook/web/components/RenderCache'
import { RowMemoryScope } from '@crook/web/components/RowMemory'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { MOMENTUM_GLIDE } from '@crook/web/motion/Springs'
import { translate } from '@crook/web/motion/TransformString'

export interface ThreadRow {
  readonly key: string
  readonly content: React.ReactNode
  readonly placeholder?: boolean
  readonly hole?: boolean
}

interface Ghost {
  readonly key: string
  readonly start: number
  readonly content: React.ReactNode
}

export interface ThreadHandle {
  readonly scrollToEnd: () => void
}

const ESTIMATED_ROW_HEIGHT = 84
const OVERSCAN = 8
const EDGE_PADDING = 16
const FOLLOW_THRESHOLD = 48
const JUMP_ICON_SIZE = 13
const ROW_GAP = 12

const ThreadRowBody = React.memo(RowBody)

const isAtBottom = (viewport: HTMLElement, lifted: number): boolean =>
  viewport.scrollHeight - lifted - viewport.scrollTop - viewport.clientHeight <= FOLLOW_THRESHOLD

const correctsOnlyGrowthAbove = (
  item: VirtualItem,
  delta: number,
  instance: Virtualizer<HTMLDivElement, Element>,
): boolean => delta > 0 && item.start < (instance.scrollOffset ?? 0)

const adjustsOnResizeWhile = (
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  following: boolean,
): void => {
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = following
    ? correctsOnlyGrowthAbove
    : undefined
}

const useOnScrollStop = (stopped: () => void) => {
  const scrolling = React.useRef(false)

  return (instance: Virtualizer<HTMLDivElement, Element>) => {
    const wasScrolling = scrolling.current

    scrolling.current = instance.isScrolling

    if (wasScrolling && !instance.isScrolling) {
      stopped()
    }
  }
}

const useScrollIntent = () => {
  const held = React.useRef(false)
  const scrolledWhileHeld = React.useRef(false)
  const gestured = React.useRef(false)
  const pinAsked = React.useRef(false)

  const gestureBegan = () => {
    gestured.current = true
    pinAsked.current = false
  }

  const pressed = () => {
    held.current = true
    scrolledWhileHeld.current = false
    gestureBegan()
  }

  const released = () => {
    held.current = false

    if (!scrolledWhileHeld.current) {
      gestured.current = false
    }
  }

  const isUserScroll = () => held.current || gestured.current

  const askedPin = React.useCallback(() => {
    pinAsked.current = true
  }, [])

  return {
    handlers: {
      onTouchStart: pressed,
      onTouchEnd: released,
      onTouchCancel: released,
      onWheel: gestureBegan,
      onKeyDown: gestureBegan,
      onPointerDown: (event: React.PointerEvent) => {
        if (event.pointerType !== 'touch') {
          const pressEnded = new AbortController()

          const release = () => {
            pressEnded.abort()
            released()
          }

          pressed()
          window.addEventListener('pointerup', release, { signal: pressEnded.signal })
          window.addEventListener('pointercancel', release, { signal: pressEnded.signal })
        }
      },
    },
    scrolled: () => {
      if (held.current) {
        scrolledWhileHeld.current = true
      }
    },
    isUserScroll,
    askedPin,
    settle: (): boolean => {
      const repins = !isUserScroll() || pinAsked.current

      gestured.current = held.current
      pinAsked.current = false

      return repins
    },
  }
}

const usePinOnResize = (
  viewport: React.RefObject<HTMLElement | null>,
  following: React.RefObject<boolean>,
  toBottom: () => void,
) => {
  React.useEffect(() => {
    const element = viewport.current

    if (element === null) {
      return undefined
    }

    const observer = new ResizeObserver(() => {
      if (following.current) {
        toBottom()
      }
    })

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [viewport, following, toBottom])
}

const useLanded = (renderedRows: number, totalSize: number): boolean => {
  const [landed, setLanded] = React.useState(false)

  React.useEffect(() => {
    if (landed || renderedRows === 0) {
      return undefined
    }

    const timer = window.setTimeout(
      () => {
        setLanded(true)
      },
      Duration.toMillis(
        Duration.seconds(
          Option.getOrElse(Option.fromUndefinedOr(motionTokens().fade.duration), () => 0),
        ),
      ),
    )

    return () => {
      window.clearTimeout(timer)
    }
  }, [landed, renderedRows, totalSize])

  return landed
}

const placeholderFrames = (
  rows: readonly ThreadRow[],
  virtualItems: readonly VirtualItem[],
): ReadonlyMap<string, Ghost> =>
  new Map(
    Arr.flatMap(virtualItems, (virtual) =>
      pipe(
        Option.fromUndefinedOr(rows[virtual.index]),
        Option.filter((row) => row.placeholder === true),
        Option.map((row): readonly [string, Ghost] => [
          row.key,
          { key: row.key, start: virtual.start, content: row.content },
        ]),
        Option.toArray,
      ),
    ),
  )

const useGhost = (
  rows: readonly ThreadRow[],
  virtualItems: readonly VirtualItem[],
  animates: boolean,
) => {
  const frames = React.useRef<ReadonlyMap<string, Ghost>>(new Map())
  const [ghost, setGhost] = React.useState<Option.Option<Ghost>>(Option.none())

  React.useLayoutEffect(() => {
    const left = ghostsOf(
      departedKeys(Arr.fromIterable(frames.current.keys()), rows),
      frames.current,
    )

    if (animates && Option.isSome(left)) {
      setGhost(left)
    }
  }, [rows])

  React.useLayoutEffect(() => {
    frames.current = placeholderFrames(rows, virtualItems)
  })

  const gone = React.useCallback(() => {
    setGhost(Option.none())
  }, [])

  return { ghost, gone }
}

const useLift = () => {
  const resting = useMotionValue(0)
  const trailing = useSpring(resting, MOMENTUM_GLIDE)
  const transform = useTransform(() => translate('Y', resting.get() - trailing.get()))
  const liftedFrom = React.useRef<Option.Option<number>>(Option.none())
  const pinUnheard = React.useRef(false)
  const current = React.useCallback(() => resting.get() - trailing.get(), [resting, trailing])
  const lifting = React.useCallback(() => pinUnheard.current || current() > 0, [current])

  const pinMoved = React.useCallback((grown: number) => {
    pinUnheard.current ||= grown !== 0
  }, [])

  const pinHeard = () => {
    pinUnheard.current = false
  }

  const firstIndex = (range: Range): number =>
    pipe(
      liftedFrom.current,
      Option.filter(() => current() > 0),
      Option.match({
        onNone: () => range.startIndex,
        onSome: (index) => Math.min(index, range.startIndex),
      }),
    )

  const heldIndex = (): Option.Option<number> => liftedFrom.current

  const holdReach = React.useCallback((reach: LiftReach) => {
    liftedFrom.current = Option.some(heldFrom(liftedFrom.current, reach, OVERSCAN))
  }, [])

  const raise = React.useCallback(
    (options: {
      readonly grown: number
      readonly ceiling: number
      readonly content: HTMLElement | null
    }) => {
      const before = current()
      const next = liftFor(options.grown, before, options.ceiling)
      const rest = resting.get() + options.grown

      if (before === 0) {
        liftedFrom.current = Option.none()
      }

      if (next < before + options.grown) {
        trailing.jump(rest - next)
      }

      resting.set(rest)
      transform.set(translate('Y', next))

      if (options.content !== null) {
        options.content.style.transform = translate('Y', next)
      }
    },
    [current, resting, trailing, transform],
  )

  return {
    transform,
    firstIndex,
    heldIndex,
    holdReach,
    raise,
    current,
    lifting,
    pinMoved,
    pinHeard,
  }
}

const ghostsOf = (
  departed: readonly string[],
  frames: ReadonlyMap<string, Ghost>,
): Option.Option<Ghost> =>
  pipe(
    departed,
    Arr.flatMap((key) => Option.toArray(Option.fromUndefinedOr(frames.get(key)))),
    Arr.head,
  )

function RowBody({
  rowKey,
  memory,
  children,
}: {
  rowKey: string
  memory: Map<string, boolean>
  children: React.ReactNode
}) {
  return (
    <RowMemoryScope store={memory} rowKey={rowKey}>
      {children}
    </RowMemoryScope>
  )
}

function ThreadGhost({
  start,
  onGone,
  children,
}: {
  start: number
  onGone: () => void
  children: React.ReactNode
}) {
  return (
    <motion.div
      aria-hidden="true"
      inert
      data-slot="thread-ghost"
      className="pointer-events-none absolute inset-x-0 top-0 px-4"
      style={{ transform: translate('Y', start) }}
      initial={{ opacity: 1 }}
      animate={motionTokens().exit}
      onAnimationComplete={onGone}
    >
      {children}
    </motion.div>
  )
}

function LatestButton({ following, onJump }: { following: boolean; onJump: () => void }) {
  return (
    <button
      type="button"
      data-slot="conversation-jump"
      aria-hidden={following || undefined}
      tabIndex={following ? -1 : undefined}
      className={cn(
        'bg-foreground text-background focus-visible:ring-ring absolute bottom-3 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full px-3 text-xs font-semibold shadow-md transition-[opacity,transform] duration-200 focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none',
        following ? 'pointer-events-none translate-y-1 opacity-0' : 'opacity-100',
      )}
      onClick={onJump}
    >
      <ArrowDown aria-hidden="true" size={JUMP_ICON_SIZE} />
      Latest
    </button>
  )
}

export function Thread({
  rows,
  dimmed,
  empty,
  handle,
}: {
  rows: readonly ThreadRow[]
  dimmed: boolean
  empty: React.ReactNode
  handle?: React.Ref<ThreadHandle>
}) {
  const viewport = React.useRef<HTMLDivElement>(null)
  const content = React.useRef<HTMLDivElement>(null)
  const [memory] = React.useState(() => new Map<string, boolean>())
  const [following, setFollowing] = React.useState(true)
  const followingRef = React.useRef(true)
  const lastTop = React.useRef(0)
  const holesAtPin = React.useRef(0)
  const intent = useScrollIntent()
  const reduce = useReducedMotion() ?? false
  const lift = useLift()
  const { raise, holdReach, lifting, pinMoved, current: liftNow } = lift
  const [, renderReach] = React.useReducer((renders: number) => renders + 1, 0)

  const { askedPin } = intent

  const toBottom = React.useCallback(() => {
    if (viewport.current !== null) {
      askedPin()
      viewport.current.scrollTop =
        viewport.current.scrollHeight - liftNow() - viewport.current.clientHeight
    }
  }, [liftNow, askedPin])

  const onScrollStop = useOnScrollStop(() => {
    if (intent.settle() && followingRef.current) {
      toBottom()
    }
  })

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: OVERSCAN,
    gap: ROW_GAP,
    paddingStart: EDGE_PADDING,
    paddingEnd: EDGE_PADDING,
    useFlushSync: false,
    rangeExtractor: (range) =>
      withTheEnd(
        defaultRangeExtractor({ ...range, startIndex: lift.firstIndex(range) }),
        range,
        followingRef.current,
        Option.filter(lift.heldIndex(), lifting),
      ),
    onChange: onScrollStop,
  })
  const totalSize = virtualizer.getTotalSize()
  const virtualItems = virtualizer.getVirtualItems()
  const landed = useLanded(virtualItems.length, totalSize)
  const holes = Arr.filter(rows, ({ hole }) => hole === true).length
  const animates = landed && !reduce
  const { ghost, gone } = useGhost(rows, virtualItems, animates)

  const follow = (next: boolean) => {
    if (next !== followingRef.current) {
      followingRef.current = next
      adjustsOnResizeWhile(virtualizer, next)
      setFollowing(next)
    }
  }

  React.useLayoutEffect(() => {
    adjustsOnResizeWhile(virtualizer, followingRef.current)
  }, [virtualizer])

  React.useImperativeHandle(
    handle,
    () => ({
      scrollToEnd: () => {
        follow(true)
        toBottom()
      },
    }),
    [virtualizer, toBottom],
  )

  React.useLayoutEffect(() => {
    const element = viewport.current
    const holeFilled = holes < holesAtPin.current

    holesAtPin.current = holes

    if (!followingRef.current || element === null) {
      return
    }

    const before = element.scrollTop

    toBottom()

    const grown = element.scrollTop - before

    pinMoved(grown)

    if (animates && grown > 0 && !holeFilled) {
      raise({ grown, ceiling: element.clientHeight, content: content.current })
    }

    const reach = reachOf(virtualizer.getVirtualItems(), liftNow(), element.clientHeight, OVERSCAN)

    if (lifting() && Option.isSome(reach)) {
      holdReach(reach.value)

      if (!reach.value.rendered) {
        renderReach()
      }
    }
  }, [
    totalSize,
    rows.length,
    holes,
    toBottom,
    animates,
    raise,
    holdReach,
    lifting,
    pinMoved,
    liftNow,
    virtualizer,
  ])

  usePinOnResize(viewport, followingRef, toBottom)

  return (
    <RenderCacheScope>
      <Dimmed dimmed={dimmed} className="relative h-full min-h-0">
        <div
          ref={viewport}
          data-slot="conversation-viewport"
          data-following={following || undefined}
          className="h-full overflow-y-auto overscroll-contain"
          {...intent.handlers}
          onScroll={(event) => {
            const top = event.currentTarget.scrollTop
            const movedUp = top < lastTop.current

            lift.pinHeard()
            lastTop.current = top
            intent.scrolled()

            if (isAtBottom(event.currentTarget, liftNow())) {
              follow(true)
            } else if (movedUp && intent.isUserScroll()) {
              follow(false)
            }
          }}
        >
          {rows.length === 0 ? (
            <div className="px-4 pt-4">{empty}</div>
          ) : (
            <motion.div
              ref={content}
              data-slot="conversation-content"
              className="relative w-full"
              style={{ height: totalSize, transform: lift.transform }}
            >
              {virtualItems.map((virtual) => {
                const row = rows[virtual.index]

                return row === undefined ? null : (
                  <div
                    key={virtual.key}
                    ref={virtualizer.measureElement}
                    data-index={virtual.index}
                    data-row={row.key}
                    className="absolute inset-x-0 top-0 px-4"
                    style={{ transform: translate('Y', virtual.start) }}
                  >
                    <ThreadRowBody rowKey={row.key} memory={memory}>
                      {row.content}
                    </ThreadRowBody>
                  </div>
                )
              })}
              {Option.match(ghost, {
                onNone: () => null,
                onSome: (found) => (
                  <ThreadGhost key={found.key} start={found.start} onGone={gone}>
                    {found.content}
                  </ThreadGhost>
                ),
              })}
            </motion.div>
          )}
        </div>
        <LatestButton
          following={following}
          onJump={() => {
            follow(true)
            askedPin()
            viewport.current?.scrollTo({
              top: viewport.current.scrollHeight,
              behavior: reduce ? 'auto' : 'smooth',
            })
          }}
        />
      </Dimmed>
    </RenderCacheScope>
  )
}
