import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as React from 'react'

const LABEL_RESOLUTION = Duration.seconds(1)

export const useNow = (): DateTime.Utc => {
  const [now, setNow] = React.useState(DateTime.nowUnsafe)

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(DateTime.nowUnsafe())
    }, Duration.toMillis(LABEL_RESOLUTION))

    return () => {
      window.clearInterval(timer)
    }
  }, [])

  return now
}
