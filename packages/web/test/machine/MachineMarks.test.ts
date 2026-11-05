import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import { pipe } from 'effect/Function'

import { MARKS } from '@crook/frames/Marks'
import { activityMachine } from '@crook/web/chat/ActivityMachine'
import { presenceMachine } from '@crook/web/chat/PresenceMachine'
import { caseNames } from '@crook/web/machine/Machine'
import { linkMachine } from '@crook/web/rpc/HubLinkState'

const MACHINE_TABLES = new Map([
  [activityMachine.name, caseNames(activityMachine.states)],
  [linkMachine.name, caseNames(linkMachine.states)],
  [presenceMachine.name, caseNames(presenceMachine.states)],
])

const MACHINE_MARKS = pipe(
  MARKS,
  Arr.flatMap(({ mark, machine }) => (machine === undefined ? [] : [{ mark, machine }])),
)

describe('the frame marks on a machine', () => {
  it('finds some, so the checks below check something', () => {
    expect(Arr.map(MACHINE_MARKS, ({ mark }) => mark)).toEqual([
      'activity-quiet',
      'composer',
      'edge-card',
    ])
  })

  it('names only states the machine has', () => {
    Arr.forEach(MACHINE_MARKS, ({ machine }) => {
      expect(MACHINE_TABLES.get(machine.name)).toEqual(expect.arrayContaining([...machine.states]))
    })
  })

  it('leaves no two marks of one track claiming the same state', () => {
    const named = Arr.flatMap(MACHINE_MARKS, ({ machine }) =>
      Arr.map(machine.states, (state) => `${machine.name} ${state}`),
    )

    expect(new Set(named).size).toBe(named.length)
  })
})
