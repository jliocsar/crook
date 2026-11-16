import { cn } from 'cn'
import * as Option from 'effect/Option'
import { ArrowDown } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import * as React from 'react'

import type { ThreadDim, ThreadHandle, ThreadRow } from '@crook/web/chat/Thread'
import { Dimmed } from '@crook/web/components/Dimmed'
import { RenderCacheScope } from '@crook/web/components/RenderCache'
import { RowMemoryScope } from '@crook/web/components/RowMemory'

const FOLLOW_THRESHOLD = 48
const JUMP_ICON_SIZE = 13
const ROW_GAP = 12
const WINDOW_ROWS = 60
const NO_BROWSER_ANCHORING: React.CSSProperties = { overflowAnchor: 'none' }

const distanceFromEnd = (viewport: HTMLElement): number => Math.max(0, -viewport.scrollTop)

const NativeRow = React.memo(function NativeRow({
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
})

const useKeepsReadersPlace = (
  viewport: React.RefObject<HTMLDivElement | null>,
  following: React.RefObject<boolean>,
) => {
  const heights = React.useRef(new WeakMap<Element, number>())
  const touching = React.useRef(false)
  const owed = React.useRef(0)

  const settle = React.useCallback(() => {
    const element = viewport.current

    if (element !== null && owed.current !== 0 && !touching.current) {
      element.scrollTop -= owed.current
      owed.current = 0
    }
  }, [viewport])

  const [observer] = React.useState(
    () =>
      new ResizeObserver((entries) => {
        const element = viewport.current

        if (element === null) {
          return
        }

        const top = element.getBoundingClientRect().top

        entries.forEach((entry) => {
          const height = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height
          const seen = heights.current.get(entry.target)
          const grown = seen === undefined ? height + ROW_GAP : height - seen
          const startedAt = entry.target.getBoundingClientRect().top + grown

          heights.current.set(entry.target, height)

          if (!following.current && grown !== 0 && startedAt >= top) {
            owed.current += grown
          }
        })

        settle()
      }),
  )

  React.useEffect(
    () => () => {
      observer.disconnect()
    },
    [observer],
  )

  const observe = React.useCallback(
    (row: HTMLDivElement | null) => {
      if (row !== null) {
        observer.observe(row)
      }
    },
    [observer],
  )

  return {
    observe,
    handlers: {
      onTouchStart: () => {
        touching.current = true
      },
      onTouchEnd: () => {
        touching.current = false
        settle()
      },
      onTouchCancel: () => {
        touching.current = false
        settle()
      },
    },
  }
}

export function NativeThread({
  rows,
  dim,
  empty,
  handle,
}: {
  rows: readonly ThreadRow[]
  dim: ThreadDim
  empty: React.ReactNode
  handle?: React.Ref<ThreadHandle>
}) {
  const viewport = React.useRef<HTMLDivElement>(null)
  const followingRef = React.useRef(true)
  const [following, setFollowing] = React.useState(true)
  const [memory] = React.useState(() => new Map<string, boolean>())
  const reduce = useReducedMotion() ?? false
  const [firstShown, setFirstShown] = React.useState<Option.Option<number>>(Option.none())
  const from = Option.getOrElse(firstShown, () => Math.max(0, rows.length - WINDOW_ROWS))
  const shown = rows.slice(from)
  const { observe, handlers } = useKeepsReadersPlace(viewport, followingRef)

  const follow = (next: boolean) => {
    if (next !== followingRef.current) {
      followingRef.current = next
      setFollowing(next)
    }
  }

  const toEnd = (behavior: ScrollBehavior) => {
    viewport.current?.scrollTo({ top: 0, behavior })
    follow(true)
  }

  React.useImperativeHandle(handle, () => ({
    scrollToEnd: () => {
      toEnd('auto')
    },
  }))

  return (
    <RenderCacheScope>
      <Dimmed dimmed={dim === 'away'} className="relative h-full min-h-0">
        <div
          ref={viewport}
          data-slot="conversation-viewport"
          data-thread="native"
          data-following={following || undefined}
          className="flex h-full flex-col-reverse overflow-y-auto overscroll-contain"
          style={NO_BROWSER_ANCHORING}
          {...handlers}
          onScroll={(event) => {
            follow(distanceFromEnd(event.currentTarget) <= FOLLOW_THRESHOLD)
          }}
        >
          {rows.length === 0 ? (
            <div className="mb-auto px-4 pt-4">{empty}</div>
          ) : (
            <div
              data-slot="conversation-content"
              data-catching-up={dim === 'catching-up' || undefined}
              className={cn(
                'mb-auto flex w-full flex-col gap-3 py-4',
                dim !== 'clear' && 'transition-opacity duration-(--motion) ease-(--ease-out)',
                dim === 'catching-up' && 'opacity-85',
              )}
            >
              {from > 0 ? (
                <button
                  type="button"
                  data-slot="thread-show-earlier-rows"
                  className="text-muted-foreground mx-auto min-h-11 px-3 text-xs font-semibold"
                  onClick={() => {
                    setFirstShown(Option.some(Math.max(0, from - WINDOW_ROWS)))
                  }}
                >
                  Show earlier messages
                </button>
              ) : null}
              {shown.map((row, index) => (
                <div
                  key={row.key}
                  ref={observe}
                  data-index={from + index}
                  data-row={row.key}
                  className="px-4 [contain-intrinsic-size:auto_84px] [content-visibility:auto]"
                >
                  <NativeRow rowKey={row.key} memory={memory}>
                    {row.content}
                  </NativeRow>
                </div>
              ))}
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
            toEnd(reduce ? 'auto' : 'smooth')
          }}
        >
          <ArrowDown aria-hidden="true" size={JUMP_ICON_SIZE} />
          Latest
        </button>
      </Dimmed>
    </RenderCacheScope>
  )
}
