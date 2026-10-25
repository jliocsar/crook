import { cn } from 'cn'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import * as React from 'react'

import { Pressable } from '@crook/web/components/press/Pressable'
import { GLIDE } from '@crook/web/motion/Springs'

type SwipeRelease = {
  readonly offset: number
  readonly velocity: number
  readonly actionsWidth: number
}

export type SwipeTone = 'secondary' | 'destructive' | 'accent' | 'primary'

export type SwipeSurface = 'card' | 'plain'

export type SwipeAction = {
  readonly label: string
  readonly icon: React.ReactNode
  readonly tone: SwipeTone
  readonly run: () => void
  readonly disabled?: boolean
}

const OPEN_VELOCITY = 500
const ACTION_WIDTH = 64
const ACTION_GAP = 8
const ELASTIC_PAST_OPEN = 0.15
const ELASTIC_PAST_CLOSED = 0.05

const SURFACE = {
  card: { frame: 'bg-card border-border border', padding: 'p-3' },
  plain: { frame: 'bg-background', padding: 'px-2 py-3' },
} satisfies Record<SwipeSurface, { frame: string; padding: string }>

const TONE = {
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  accent: 'bg-accent text-accent-foreground',
  primary: 'bg-primary text-primary-foreground',
} satisfies Record<SwipeTone, string>

export const settlesOpen = ({ offset, velocity, actionsWidth }: SwipeRelease): boolean => {
  if (velocity < -OPEN_VELOCITY) {
    return true
  }

  if (velocity > OPEN_VELOCITY) {
    return false
  }

  return offset < -actionsWidth / 2
}

export const useOpenRow = () => {
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [dragging, setDragging] = React.useState(false)

  return { openId, setOpenId, dragging, setDragging, holding: dragging || openId !== null }
}

export type OpenRow = ReturnType<typeof useOpenRow>

export function SwipeRow({
  id,
  row,
  actions,
  surface = 'card',
  onTap,
  onLongPress,
  children,
}: {
  id: string
  row: OpenRow
  actions: readonly SwipeAction[]
  surface?: SwipeSurface
  onTap: (opener: HTMLElement) => void
  onLongPress?: () => void
  children: React.ReactNode
}) {
  const reduce = useReducedMotion() ?? false
  const offsetX = useMotionValue(0)
  const swallowTap = React.useRef(false)
  const [dragging, setDragging] = React.useState(false)
  const actionsWidth = actions.length * (ACTION_WIDTH + ACTION_GAP)
  const isOpen = row.openId === id
  const actionsOpacity = useTransform(offsetX, (value) => (value < 0 ? 1 : 0))

  const settle = (open: boolean) => {
    const target = open ? -actionsWidth : 0

    if (reduce) {
      offsetX.jump(target)

      return undefined
    }

    return animate(offsetX, target, GLIDE)
  }

  React.useEffect(() => {
    const controls = settle(isOpen)

    return () => {
      controls?.stop()
    }
  }, [isOpen, actionsWidth, reduce, offsetX])

  const drag = (value: boolean) => {
    setDragging(value)
    row.setDragging(value)
  }

  return (
    <div className="relative rounded-xl" data-slot="swipe-row">
      <motion.div
        inert={!isOpen}
        data-slot="swipe-actions"
        className="absolute inset-y-0 right-0 flex items-stretch"
        style={{
          width: actionsWidth,
          gap: ACTION_GAP,
          paddingLeft: ACTION_GAP,
          opacity: actionsOpacity,
        }}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            disabled={action.disabled}
            onClick={() => {
              row.setOpenId(null)
              action.run()
            }}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold disabled:opacity-50',
              TONE[action.tone],
            )}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
      </motion.div>
      <motion.div
        data-slot="swipe-card"
        className={cn('relative rounded-xl', SURFACE[surface].frame)}
        style={{ x: offsetX, touchAction: 'pan-y' }}
        drag="x"
        dragConstraints={{ left: -actionsWidth, right: 0 }}
        dragElastic={{ left: ELASTIC_PAST_OPEN, right: ELASTIC_PAST_CLOSED }}
        dragMomentum={false}
        onPointerDownCapture={() => {
          swallowTap.current = row.openId !== null && row.openId !== id

          if (swallowTap.current) {
            row.setOpenId(null)
          }
        }}
        onDragStart={() => {
          swallowTap.current = true
          drag(true)
        }}
        onDragEnd={(_event, info) => {
          drag(false)
          const open = settlesOpen({
            offset: offsetX.get(),
            velocity: info.velocity.x,
            actionsWidth,
          })

          row.setOpenId(open ? id : null)
          settle(open)
        }}
      >
        <Pressable
          suppress={dragging || isOpen}
          frameClassName="rounded-xl"
          className={SURFACE[surface].padding}
          onTap={(opener) => {
            if (swallowTap.current) {
              swallowTap.current = false

              return
            }

            if (isOpen) {
              row.setOpenId(null)

              return
            }

            onTap(opener)
          }}
          onLongPress={onLongPress}
        >
          {children}
        </Pressable>
      </motion.div>
    </div>
  )
}
