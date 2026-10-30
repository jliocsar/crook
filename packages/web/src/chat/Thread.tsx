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

import { departedKeys, liftFor } from '@crook/web/chat/Reveal'
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
}

interface Ghost {
  readonly key: string
  readonly start: number
  readonly content: React.ReactNode
}

export interface ThreadHandle {
  readonly scrollToKey: (key: string) => void
  readonly scrollToEnd: () => void
}

const ESTIMATED_ROW_HEIGHT = 84
const OVERSCAN = 8
const ROW_GAP = 12
const EDGE_PADDING = 16
const FOLLOW_THRESHOLD = 48
const JUMP_ICON_SIZE = 13

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

const useSettled = (rowCount: number): boolean => {
  const [settled, setSettled] = React.useState(false)

  React.useEffect(() => {
    if (settled || rowCount === 0) {
      return undefined
    }

    const timer = window.setTimeout(
      () => {
        setSettled(true)
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
  }, [settled, rowCount])

  return settled
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
  const lastKey = Option.getOrUndefined(Option.map(Arr.last(rows), (row) => row.key))

  React.useLayoutEffect(() => {
    const left = ghostsOf(departedKeys(Array.from(frames.current.keys()), rows), frames.current)

    if (animates && Option.isSome(left)) {
      setGhost(left)
    }
  }, [rows.length, lastKey])

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
  const current = React.useCallback(() => resting.get() - trailing.get(), [resting, trailing])

  const firstIndex = (range: Range): number =>
    pipe(
      liftedFrom.current,
      Option.filter(() => current() > 0),
      Option.match({
        onNone: () => range.startIndex,
        onSome: (index) => Math.min(index, range.startIndex),
      }),
    )

  const raise = React.useCallback(
    (options: {
      readonly grown: number
      readonly ceiling: number
      readonly content: HTMLElement | null
      readonly indexAt: (lifted: number) => Option.Option<number>
    }) => {
      const before = current()
      const next = liftFor(options.grown, before, options.ceiling)
      const rest = resting.get() + options.grown

      liftedFrom.current = options.indexAt(next)

      if (next < before + options.grown) {
        trailing.jump(rest - next)
      }

      resting.set(rest)

      if (options.content !== null) {
        options.content.style.transform = translate('Y', next)
      }
    },
    [current, resting, trailing],
  )

  return { transform, firstIndex, raise, current }
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
  const intent = useScrollIntent()
  const reduce = useReducedMotion() ?? false
  const settled = useSettled(rows.length)
  const animates = settled && !reduce
  const lift = useLift()
  const { raise, current: liftNow } = lift

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
      defaultRangeExtractor({ ...range, startIndex: lift.firstIndex(range) }),
    onChange: onScrollStop,
  })
  const totalSize = virtualizer.getTotalSize()
  const virtualItems = virtualizer.getVirtualItems()
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
      scrollToKey: (key: string) => {
        const index = rows.findIndex((row) => row.key === key)

        if (index >= 0) {
          follow(false)
          virtualizer.scrollToIndex(index, {
            align: 'center',
            behavior: reduce ? 'auto' : 'smooth',
          })
        }
      },
      scrollToEnd: () => {
        follow(true)
        toBottom()
      },
    }),
    [rows, virtualizer, reduce, toBottom],
  )

  React.useLayoutEffect(() => {
    const element = viewport.current

    if (!followingRef.current || element === null) {
      return
    }

    const before = element.scrollTop

    toBottom()

    const grown = element.scrollTop - before

    if (animates && grown > 0) {
      raise({
        grown,
        ceiling: element.clientHeight,
        content: content.current,
        indexAt: (lifted) =>
          Option.map(
            Option.fromUndefinedOr(virtualizer.getVirtualItemForOffset(element.scrollTop - lifted)),
            (item) => item.index,
          ),
      })
    }
  }, [totalSize, rows.length, toBottom, animates, raise, virtualizer])

  React.useEffect(() => {
    const element = viewport.current

    if (element === null) {
      return undefined
    }

    const observer = new ResizeObserver(() => {
      if (followingRef.current) {
        toBottom()
      }
    })

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [toBottom])

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
