export type SwipeRelease = {
  readonly offset: number
  readonly velocity: number
  readonly actionsWidth: number
}

export const OPEN_VELOCITY = 500

export const settlesOpen = ({ offset, velocity, actionsWidth }: SwipeRelease): boolean => {
  if (velocity < -OPEN_VELOCITY) {
    return true
  }

  if (velocity > OPEN_VELOCITY) {
    return false
  }

  return offset < -actionsWidth / 2
}
