import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'

const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

export const shortElapsed = (now: DateTime.Utc, since: DateTime.Utc): string => {
  const seconds = Math.max(0, Math.floor(Duration.toSeconds(DateTime.distance(since, now))))
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)

  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`
  }

  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes}m`
  }

  if (hours < HOURS_PER_DAY) {
    return `${hours}h`
  }

  return `${Math.floor(hours / HOURS_PER_DAY)}d`
}
