import * as React from 'react'

export const COLUMN_MAX_WIDTH = 430

export const COLUMN_STYLE = {
  left: `max(0px, calc(50vw - ${COLUMN_MAX_WIDTH / 2}px))`,
  width: `min(100vw, ${COLUMN_MAX_WIDTH}px)`,
} as const

const measure = (): number => Math.min(window.innerWidth, COLUMN_MAX_WIDTH)

export const useColumnWidth = (): number => {
  const [width, setWidth] = React.useState(measure)
  React.useEffect(() => {
    const onResize = () => {
      setWidth(measure())
    }

    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return width
}
