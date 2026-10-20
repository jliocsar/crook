import { cn } from 'cn'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import * as React from 'react'

import { settlesOpen } from '@/components/swipe/Gestures'
import { Pressable } from '@/components/swipe/Pressable'
import { GLIDE } from '@/motion/Springs'

export type SwipeTone = 'secondary' | 'destructive' | 'accent' | 'primary'

export type SwipeAction = {
  readonly label: string
  readonly icon: React.ReactNode
  readonly tone: SwipeTone
  readonly run: () => void
  readonly disabled?: boolean
}

export const ACTION_WIDTH = 64
export const ACTION_GAP = 8

const TONE = {
  secondary: 'bg-secondary text-secondary-foreground',
  destructive: 'bg-destructive text-destructive-foreground',
  accent: 'bg-accent text-accent-foreground',
  primary: 'bg-primary text-primary-foreground',
} satisfies Record<SwipeTone, string>

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
  onTap,
  onLongPress,
  children,
}: {
  id: string
  row: OpenRow
  actions: readonly SwipeAction[]
  onTap: () => void
  onLongPress: () => void
  children: React.ReactNode
}) {
  const reduce = useReducedMotion() ?? false
  const offsetX = useMotionValue(0)
  const swallowTap = React.useRef(false)
  const [dragging, setDragging] = React.useState(false)
  const actionsWidth = actions.length * (ACTION_WIDTH + ACTION_GAP)
  const isOpen = row.openId === id
  const actionsOpacity = useTransform(offsetX, (value) => (value < 0 ? 1 : 0))

  React.useEffect(() => {
    const target = isOpen ? -actionsWidth : 0

    if (reduce) {
      offsetX.jump(target)

      return undefined
    }

    const controls = animate(offsetX, target, GLIDE)

    return () => {
      controls.stop()
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
        className="absolute inset-y-0 right-0 flex items-stretch gap-2 pl-2"
        style={{ width: actionsWidth, opacity: actionsOpacity }}
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
        className="bg-card border-border relative rounded-xl border"
        style={{ x: offsetX, touchAction: 'pan-y' }}
        drag="x"
        dragConstraints={{ left: -actionsWidth, right: 0 }}
        dragElastic={{ left: 0.15, right: 0.05 }}
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

          if (!reduce) {
            animate(offsetX, open ? -actionsWidth : 0, GLIDE)
          }
        }}
      >
        <Pressable
          suppress={dragging || isOpen}
          frameClassName="rounded-xl"
          className="p-3"
          onTap={() => {
            if (swallowTap.current) {
              swallowTap.current = false

              return
            }

            if (isOpen) {
              row.setOpenId(null)

              return
            }

            onTap()
          }}
          onLongPress={onLongPress}
        >
          {children}
        </Pressable>
      </motion.div>
    </div>
  )
}
