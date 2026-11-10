import type { SpringOptions, Transition } from 'motion/react'

const GLIDE_STIFFNESS = 341

export const SPRING = { type: 'spring', duration: 0.5, bounce: 0.2 } as const satisfies Transition
export const INSTANT = { duration: 0 } as const satisfies Transition
export const GLIDE = { type: 'spring', duration: 0.5, bounce: 0 } as const satisfies Transition

export const MOMENTUM_GLIDE = {
  stiffness: GLIDE_STIFFNESS,
  damping: 2 * Math.sqrt(GLIDE_STIFFNESS),
  mass: 1,
} as const satisfies SpringOptions
