import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'

const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const TENTHS_PER_SECOND = 10
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

const twoDigits = (value: number): string => String(value).padStart(2, '0')

export const clockElapsed = (now: DateTime.Utc, since: DateTime.Utc): string => {
  const seconds = Math.max(0, Math.floor(Duration.toSeconds(DateTime.distance(since, now))))
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  const hours = Math.floor(minutes / MINUTES_PER_HOUR)

  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`
  }

  if (minutes < MINUTES_PER_HOUR) {
    return `${minutes}m ${twoDigits(seconds % SECONDS_PER_MINUTE)}s`
  }

  if (hours < HOURS_PER_DAY) {
    return `${hours}h ${twoDigits(minutes % MINUTES_PER_HOUR)}m`
  }

  return `${Math.floor(hours / HOURS_PER_DAY)}d`
}

const runDuration = (span: Duration.Duration): string => {
  const milliseconds = Math.round(Math.max(0, Duration.toMillis(span)))
  const exactSeconds = Duration.toSeconds(Duration.millis(milliseconds))
  const tenths = Math.round(exactSeconds * TENTHS_PER_SECOND) / TENTHS_PER_SECOND
  const seconds = Math.round(exactSeconds)

  if (exactSeconds < 1) {
    return `${milliseconds}ms`
  }

  if (tenths < ONE_DECIMAL_BELOW_SECONDS) {
    return `${tenths.toFixed(1)}s`
  }

  if (seconds < SECONDS_PER_MINUTE) {
    return `${seconds}s`
  }

  return `${Math.floor(seconds / SECONDS_PER_MINUTE)}m ${seconds % SECONDS_PER_MINUTE}s`
}

export const spanDuration = (from: DateTime.Utc, to: DateTime.Utc): string =>
  runDuration(DateTime.distance(from, to))

export const runningSpan = (
  startedAt: Option.Option<DateTime.Utc>,
  finishedAt: Option.Option<DateTime.Utc>,
  running: boolean,
  now: DateTime.Utc,
): Option.Option<string> =>
  Option.map(
    Option.all({
      from: startedAt,
      to: Option.orElse(finishedAt, () => Option.liftPredicate(now, () => running)),
    }),
    ({ from, to }) => spanDuration(from, to),
  )
