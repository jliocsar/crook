import * as React from 'react'

const HOLD_FRAMES = 24
const HOLD_MS = 400

export const useSkeletonHold = (shown: boolean): boolean => {
  const [holding, setHolding] = React.useState(shown)
  const [wasShown, setWasShown] = React.useState(shown)

  if (shown !== wasShown) {
    setWasShown(shown)

    if (shown) {
      setHolding(true)
    }
  }

  React.useEffect(() => {
    if (!holding) {
      return undefined
    }

    const first = performance.now()
    let frames = 0
    let handle = 0

    const onFrame = (now: number) => {
      frames += 1

      if (frames >= HOLD_FRAMES && now - first >= HOLD_MS) {
        setHolding(false)
      } else {
        handle = requestAnimationFrame(onFrame)
      }
    }

    handle = requestAnimationFrame(onFrame)

    return () => {
      cancelAnimationFrame(handle)
    }
  }, [holding])

  return holding
}
