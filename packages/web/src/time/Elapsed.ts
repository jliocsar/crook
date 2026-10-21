import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'

const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const MILLISECONDS_PER_SECOND = 1000
const ONE_DECIMAL_BELOW_SECONDS = 10

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

export const runDuration = (milliseconds: number): string => {
  const shown = Math.max(0, milliseconds)
  const seconds = shown / MILLISECONDS_PER_SECOND

  if (shown < MILLISECONDS_PER_SECOND) {
    return `${Math.round(shown)}ms`
  }

  if (seconds < SECONDS_PER_MINUTE) {
    return seconds < ONE_DECIMAL_BELOW_SECONDS
      ? `${seconds.toFixed(1)}s`
      : `${Math.round(seconds)}s`
  }

  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)

  return `${minutes}m ${Math.round(seconds - minutes * SECONDS_PER_MINUTE)}s`
}

export const spanDuration = (from: DateTime.Utc, to: DateTime.Utc): string =>
  runDuration(Duration.toMillis(DateTime.distance(from, to)))
