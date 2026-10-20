export type BackGesture = {
  readonly offset: number
  readonly velocity: number
  readonly width: number
}

export const BACK_DISTANCE_SHARE = 1 / 3
export const BACK_VELOCITY = 500

export const commitsBack = ({ offset, velocity, width }: BackGesture): boolean =>
  offset > width * BACK_DISTANCE_SHARE || velocity > BACK_VELOCITY
