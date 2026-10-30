import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import type { TurnEvidence } from '@crook/web/chat/ChatItems'
import { HerdrTurn, holdingSince, nextWorkingHold, sameHold } from '@crook/web/chat/WorkingHold'

const STARTED = DateTime.makeUnsafe('2026-10-20T12:00:00Z')
const LATER = DateTime.makeUnsafe('2026-10-20T12:00:30Z')
const EARLIER = DateTime.makeUnsafe('2026-10-20T11:59:00Z')

const evidence = (ends: boolean, at = LATER): Option.Option<TurnEvidence> =>
  Option.some({ ends, at: Option.some(at) })

const PREVIOUS_ANSWER = evidence(true, EARLIER)
const PROMPT = evidence(false)
const ANSWER = evidence(true)

const working = HerdrTurn.Working({ since: STARTED })

const step = (
  heldSince: Option.Option<DateTime.Utc>,
  herdr: HerdrTurn,
  found: Option.Option<TurnEvidence>,
) => {
  const next = nextWorkingHold(heldSince, { herdr, evidence: found })

  return { next, held: Option.isSome(holdingSince(next, found)) }
}

const HELD = Option.some(STARTED)

describe('nextWorkingHold', () => {
  it('holds the Working row while herdr says Claude works and the turn has not ended since', () => {
    expect(step(Option.none(), working, PREVIOUS_ANSWER).held).toBe(true)
    expect(step(Option.none(), working, PROMPT).held).toBe(true)
    expect(step(Option.none(), working, Option.none()).held).toBe(true)
  })

  it('lets the Working row go once the answer lands, though herdr still says Claude works', () => {
    expect(step(HELD, working, ANSWER).held).toBe(false)
  })

  it('keeps the Working row after herdr goes idle until the answer lands', () => {
    const idle = step(HELD, HerdrTurn.Idle(), PROMPT)

    expect(idle.held).toBe(true)
    expect(step(idle.next, HerdrTurn.Idle(), ANSWER)).toStrictEqual({
      next: Option.none(),
      held: false,
    })
  })

  it('goes with herdr when nothing about the turn reached the transcript while it worked', () => {
    expect(step(HELD, HerdrTurn.Idle(), PREVIOUS_ANSWER).held).toBe(false)
    expect(step(HELD, HerdrTurn.Idle(), Option.none()).held).toBe(false)
  })

  it('drops the hold when Claude blocks, the pane goes away or the watch fails', () => {
    expect(step(HELD, HerdrTurn.Elsewhere(), PROMPT).held).toBe(false)
  })

  it('holds nothing for a chat opened on an idle agent whose transcript looks unfinished', () => {
    expect(step(Option.none(), HerdrTurn.Idle(), PROMPT).held).toBe(false)
  })

  it('starts a fresh hold when herdr reports a new turn, and keeps it while the turn lasts', () => {
    const next = step(HELD, HerdrTurn.Working({ since: LATER }), ANSWER)

    expect(next.held).toBe(true)
    expect(sameHold(step(HELD, working, PROMPT).next, HELD)).toBe(true)
  })
})
