import * as Option from 'effect/Option'
import { describe, expect, it } from 'vitest'

import { lockedAxis } from '@crook/web/components/swipe/AxisLock'

const ORIGIN = { clientX: 200, clientY: 200 }

const lockAt = (clientX: number, clientY: number) => lockedAxis(ORIGIN, { clientX, clientY })

describe('lockedAxis', () => {
  it('waits until the finger has moved 10px along either axis', () => {
    expect(lockAt(209, 209)).toEqual(Option.none())
    expect(lockAt(190, 200)).toEqual(Option.some('x'))
    expect(lockAt(200, 210)).toEqual(Option.some('y'))
  })

  it('locks to whichever axis moved further, vertical on a tie', () => {
    expect(lockAt(180, 211)).toEqual(Option.some('x'))
    expect(lockAt(211, 180)).toEqual(Option.some('y'))
    expect(lockAt(185, 215)).toEqual(Option.some('y'))
  })
})
