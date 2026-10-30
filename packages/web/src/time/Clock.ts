import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import { pipe } from 'effect/Function'

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

export const clockTime = (at: DateTime.Utc): string =>
  pipe(
    CLOCK.formatToParts(DateTime.toEpochMillis(at)),
    Arr.filter((part) => part.type !== 'dayPeriod'),
    Arr.map((part) => part.value),
    Arr.join(''),
  ).trim()
