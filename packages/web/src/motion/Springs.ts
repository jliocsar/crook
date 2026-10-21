import type { Transition } from 'motion/react'

export const SPRING = { type: 'spring', duration: 0.5, bounce: 0.2 } as const satisfies Transition
export const INSTANT = { duration: 0 } as const satisfies Transition
export const GLIDE = { type: 'spring', duration: 0.5, bounce: 0 } as const satisfies Transition
