import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from 'cn'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import { ArrowDown } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import * as React from 'react'

import { Dimmed } from '@crook/web/components/Dimmed'
import { RowMemoryScope } from '@crook/web/components/RowMemory'
import { motionTokens } from '@crook/web/motion/MotionTokens'
import { translate, useTransformString } from '@crook/web/motion/TransformString'

export interface ThreadRow {
  readonly key: string
  readonly content: React.ReactNode
}

export interface ThreadHandle {
  readonly scrollToKey: (key: string) => void
}

const ESTIMATED_ROW_HEIGHT = 84
const OVERSCAN = 8
const ROW_GAP = 12
const EDGE_PADDING = 16
const FOLLOW_THRESHOLD = 48
const RISE = 8
const JUMP_ICON_SIZE = 13

const isAtBottom = (viewport: HTMLElement): boolean =>
  viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= FOLLOW_THRESHOLD

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

function Appear({
  rowKey,
  rise,
  onShown,
  children,
}: {
  rowKey: string
  rise: boolean
  onShown: (rowKey: string) => void
  children: React.ReactNode
}) {
  const transform = useTransformString()

  React.useEffect(() => {
    onShown(rowKey)
  }, [rowKey, onShown])

  return (
    <motion.div
      className="min-w-0"
      initial={rise ? { opacity: 0, transform: transform.translate('Y', RISE) } : false}
      animate={{ opacity: 1, transform: translate('Y', 0) }}
      transition={motionTokens().fade}
    >
      {children}
    </motion.div>
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
  const [rises] = React.useState(() => new Map<string, boolean>())
  const [memory] = React.useState(() => new Map<string, boolean>())
  const [following, setFollowing] = React.useState(true)
  const followingRef = React.useRef(true)
  const reduce = useReducedMotion() ?? false
  const settled = useSettled(rows.length)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: OVERSCAN,
    gap: ROW_GAP,
    paddingStart: EDGE_PADDING,
    paddingEnd: EDGE_PADDING,
  })
  const totalSize = virtualizer.getTotalSize()

  const follow = (next: boolean) => {
    followingRef.current = next
    setFollowing(next)
  }

  const toBottom = React.useCallback(() => {
    if (viewport.current !== null) {
      viewport.current.scrollTop = viewport.current.scrollHeight
    }
  }, [])

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
    }),
    [rows, virtualizer, reduce],
  )

  React.useLayoutEffect(() => {
    if (followingRef.current) {
      toBottom()
    }
  }, [totalSize, rows.length, toBottom])

  React.useLayoutEffect(() => {
    if (!settled) {
      for (const row of rows) {
        rises.set(row.key, false)
      }
    }
  }, [rows, settled, rises])

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

  const risesFirstTime = (key: string): boolean => rises.get(key) ?? settled

  const shown = React.useCallback(
    (key: string) => {
      rises.set(key, false)
    },
    [rises],
  )

  return (
    <Dimmed dimmed={dimmed} className="relative h-full min-h-0">
      <div
        ref={viewport}
        data-slot="conversation-viewport"
        data-following={following || undefined}
        className="h-full overflow-y-auto overscroll-contain"
        onScroll={(event) => {
          const next = isAtBottom(event.currentTarget)

          if (next !== followingRef.current) {
            follow(next)
          }
        }}
      >
        {rows.length === 0 ? (
          <div className="px-4 pt-4">{empty}</div>
        ) : (
          <div className="relative w-full" style={{ height: totalSize }}>
            {virtualizer.getVirtualItems().map((virtual) => {
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
                  <RowMemoryScope store={memory} rowKey={row.key}>
                    <Appear rowKey={row.key} rise={risesFirstTime(row.key)} onShown={shown}>
                      {row.content}
                    </Appear>
                  </RowMemoryScope>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <button
        type="button"
        data-slot="conversation-jump"
        aria-hidden={following || undefined}
        tabIndex={following ? -1 : undefined}
        className={cn(
          'bg-foreground text-background focus-visible:ring-ring absolute bottom-3 left-1/2 inline-flex min-h-11 -translate-x-1/2 items-center gap-1.5 rounded-full px-3 text-xs font-semibold shadow-md transition-[opacity,transform] duration-200 focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none',
          following ? 'pointer-events-none translate-y-1 opacity-0' : 'opacity-100',
        )}
        onClick={() => {
          follow(true)
          viewport.current?.scrollTo({
            top: viewport.current.scrollHeight,
            behavior: reduce ? 'auto' : 'smooth',
          })
        }}
      >
        <ArrowDown aria-hidden="true" size={JUMP_ICON_SIZE} />
        Latest
      </button>
    </Dimmed>
  )
}
