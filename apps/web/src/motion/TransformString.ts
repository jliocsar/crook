import { useReducedMotion } from 'motion/react'

type Axis = 'X' | 'Y'
type Unit = 'px' | '%'

export const translate = (axis: Axis, distance: number, unit: Unit = 'px'): string =>
  `translate${axis}(${distance}${unit})`

export const scale = (factor: number): string => `scale(${factor})`

export const useTransformString = () => {
  const reduce = useReducedMotion() ?? false

  return {
    translate: (axis: Axis, distance: number, unit: Unit = 'px') =>
      translate(axis, reduce ? 0 : distance, unit),
    scale: (factor: number) => scale(reduce ? 1 : factor),
  }
}
