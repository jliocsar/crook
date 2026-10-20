import { cn } from 'cn'
import { motion } from 'motion/react'
import * as React from 'react'

import { useLongPress } from '@crook/web/components/press/LongPress'
import { motionTokens } from '@crook/web/motion/MotionTokens'

const INSTANT = { duration: 0 } as const
const HOVER_HIGHLIGHT = 0.5

const highlightOpacity = ({
  suppress,
  pressed,
  hovered,
}: {
  suppress: boolean
  pressed: boolean
  hovered: boolean
}): number => {
  if (suppress) {
    return 0
  }

  if (pressed) {
    return 1
  }

  return hovered ? HOVER_HIGHLIGHT : 0
}

export function Pressable({
  onTap,
  onLongPress,
  suppress = false,
  className,
  frameClassName,
  children,
}: {
  onTap: (opener: HTMLElement) => void
  onLongPress: () => void
  suppress?: boolean
  className?: string
  frameClassName?: string
  children: React.ReactNode
}) {
  const press = useLongPress(onLongPress)
  const [pressed, setPressed] = React.useState(false)
  const [hovered, setHovered] = React.useState(false)

  return (
    <motion.button
      type="button"
      onTapStart={() => {
        setPressed(true)
      }}
      onTap={() => {
        setPressed(false)
      }}
      onTapCancel={() => {
        setPressed(false)
      }}
      onHoverStart={() => {
        setHovered(true)
      }}
      onHoverEnd={() => {
        setHovered(false)
      }}
      {...press.handlers}
      onClick={(event) => {
        if (!press.consumeLongPress()) {
          onTap(event.currentTarget)
        }
      }}
      className={cn(
        'relative flex w-full touch-manipulation text-left select-none [-webkit-touch-callout:none]',
        frameClassName,
      )}
    >
      <motion.span
        aria-hidden="true"
        className="bg-muted pointer-events-none absolute inset-0 rounded-[inherit]"
        initial={false}
        animate={{ opacity: highlightOpacity({ suppress, pressed, hovered }) }}
        transition={pressed && !suppress ? INSTANT : motionTokens().tap}
      />
      <span className={cn('relative flex min-w-0 flex-1 items-center', className)}>{children}</span>
    </motion.button>
  )
}
