import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { MachineId, PaneId } from '@crook/domain/Ids'
import { OpenedTimes, withOpened } from '@crook/domain/OpenedTimes'

const START = DateTime.makeUnsafe('2026-10-20T09:00:00.000Z')
const LATER = DateTime.addDuration(START, Duration.minutes(5))
const LAPTOP = MachineId.make('laptop')
const DESK = MachineId.make('desk')
const FIRST = PaneId.make('w1:p1')
const SECOND = PaneId.make('w1:p2')
const GONE = PaneId.make('w1:p9')

const earlier: OpenedTimes = {
  [LAPTOP]: { [FIRST]: START, [GONE]: START },
  [DESK]: { [GONE]: START },
}

describe('withOpened', () => {
  it('stamps the opened pane and drops the panes its machine no longer lists', () => {
    const times = withOpened(earlier, {
      machine: LAPTOP,
      pane: SECOND,
      at: LATER,
      listed: Option.some([FIRST, SECOND]),
    })

    expect(times).toEqual({
      [LAPTOP]: { [FIRST]: START, [SECOND]: LATER },
      [DESK]: { [GONE]: START },
    })
  })

  it('keeps every pane of a machine whose agents it cannot see', () => {
    const times = withOpened(earlier, {
      machine: LAPTOP,
      pane: FIRST,
      at: LATER,
      listed: Option.none(),
    })

    expect(times).toEqual({
      [LAPTOP]: { [FIRST]: LATER, [GONE]: START },
      [DESK]: { [GONE]: START },
    })
  })

  it('starts a machine it has never seen', () => {
    const times = withOpened({}, { machine: DESK, pane: FIRST, at: START, listed: Option.none() })

    expect(times).toEqual({ [DESK]: { [FIRST]: START } })
  })

  it('round-trips through its stored form', () => {
    const stored = Schema.encodeSync(OpenedTimes)(earlier)

    expect(stored).toEqual({
      laptop: { 'w1:p1': '2026-10-20T09:00:00.000Z', 'w1:p9': '2026-10-20T09:00:00.000Z' },
      desk: { 'w1:p9': '2026-10-20T09:00:00.000Z' },
    })
    expect(Schema.decodeSync(OpenedTimes)(stored)).toEqual(earlier)
  })
})
