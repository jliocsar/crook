import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import {
  AWAY,
  closed,
  exited,
  graceEnded,
  LOADING,
  machineOffline,
  machineReconnecting,
  NOT_CLAUDE,
  PANE_FOUND,
  PANE_LIVE,
  PANE_UNKNOWN,
  paneClosed,
  paneExited,
  PresenceCommand,
  presenceEventOf,
  presenceMachine,
  quietEnded,
  reconnecting,
  redialing,
} from '@crook/web/chat/PresenceMachine'
import type { PresenceEvent, PresenceState } from '@crook/web/chat/PresenceMachine'
import { PaneId } from '@crook/domain/Ids'
import { walk } from '@crook/web/machine/Walk'

import { presenceWalk } from '../../charts/PresenceWalk.ts'
import { agent, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'

const PANE = PaneId.make('w1:p1')
const DROP = DateTime.add(START, { seconds: 10 })
const LATER_DROP = DateTime.add(START, { seconds: 90 })

const after = (start: PresenceState, events: readonly PresenceEvent[]): PresenceState =>
  Arr.reduce(events, start, (state, event) => presenceMachine.transition(state, event)[0])

const snapshotOf = (entry: ReturnType<typeof machine>) =>
  Option.some(new HerdSnapshot({ view: herd([entry]), syncedAt: START }))

describe('the presence machine', () => {
  it('walks clean: every state reached, nothing trapped, a stale wait changes nothing', () => {
    const walked = walk(presenceWalk)

    expect(walked.findings).toEqual([])
  })

  it('keeps the dock through a machine that redials and comes back', () => {
    expect(after(PANE_LIVE, [machineReconnecting(DROP)])).toEqual(redialing(DROP))
    expect(after(PANE_LIVE, [machineReconnecting(DROP), quietEnded(DROP)])).toEqual(
      reconnecting(DROP),
    )
    expect(after(PANE_LIVE, [machineReconnecting(DROP), quietEnded(DROP), PANE_FOUND])).toEqual(
      PANE_LIVE,
    )
  })

  it('reaches the card once the hub gives the machine up', () => {
    expect(
      after(PANE_LIVE, [machineReconnecting(DROP), quietEnded(DROP), machineOffline(DROP)]),
    ).toEqual(AWAY)
    expect(after(PANE_LIVE, [machineReconnecting(DROP), machineOffline(DROP)])).toEqual(AWAY)
  })

  it('waits out its own grace when the hub calls a machine offline without a redial', () => {
    const quiet = after(PANE_LIVE, [machineOffline(DROP)])
    const waiting = after(quiet, [quietEnded(DROP)])

    expect(quiet).toEqual(redialing(DROP))
    expect(presenceMachine.transition(quiet, quietEnded(DROP))[1]).toEqual([
      PresenceCommand.WaitOutGrace({ drop: DROP }),
    ])
    expect(waiting).toEqual(reconnecting(DROP))
    expect(after(waiting, [graceEnded(DROP)])).toEqual(AWAY)
    expect(after(waiting, [PANE_FOUND])).toEqual(PANE_LIVE)
  })

  it('opens straight on the card for a machine already offline', () => {
    expect(after(LOADING, [machineOffline(DROP)])).toEqual(AWAY)
  })

  it('drops the end of a wait for an earlier drop', () => {
    expect(after(redialing(LATER_DROP), [quietEnded(DROP)])).toEqual(redialing(LATER_DROP))
    expect(after(reconnecting(LATER_DROP), [graceEnded(DROP)])).toEqual(reconnecting(LATER_DROP))
    expect(after(PANE_LIVE, [graceEnded(DROP), quietEnded(DROP)])).toEqual(PANE_LIVE)
  })

  it('gives a machine it saw coming back from the card a grace of its own', () => {
    const [state, commands] = presenceMachine.transition(AWAY, machineReconnecting(DROP))

    expect(state).toEqual(reconnecting(DROP))
    expect(commands).toEqual([PresenceCommand.WaitOutGrace({ drop: DROP })])
  })

  it('keeps the first time a pane ended', () => {
    expect(after(exited(DROP), [paneExited(LATER_DROP)])).toEqual(exited(DROP))
    expect(after(closed(DROP), [paneClosed(LATER_DROP)])).toEqual(closed(DROP))
    expect(after(exited(DROP), [paneClosed(LATER_DROP)])).toEqual(closed(LATER_DROP))
  })

  it('leaves an ended pane alone while its machine redials', () => {
    expect(after(exited(DROP), [machineReconnecting(LATER_DROP)])).toEqual(exited(DROP))
    expect(after(NOT_CLAUDE, [machineReconnecting(LATER_DROP)])).toEqual(NOT_CLAUDE)
  })

  it('stops offering a restart on a machine that is gone', () => {
    expect(after(exited(DROP), [machineOffline(LATER_DROP)])).toEqual(AWAY)
    expect(after(closed(DROP), [machineOffline(LATER_DROP)])).toEqual(AWAY)
  })

  it('shows no card on a pane that never ran Claude, whatever its machine does', () => {
    expect(after(NOT_CLAUDE, [machineOffline(LATER_DROP)])).toEqual(NOT_CLAUDE)
  })
})

describe('presenceEventOf', () => {
  const eventFor = (
    entry: ReturnType<typeof machine>,
    seenBefore = false,
    verified = true,
  ): PresenceEvent => presenceEventOf(snapshotOf(entry), LAPTOP, PANE, seenBefore, verified)

  it('finds a pane with Claude in it', () => {
    expect(eventFor(machine(LAPTOP, [agent('w1:p1', 'idle')]))).toEqual(PANE_FOUND)
  })

  it('waits for the hub before calling a pane closed that only a stale herd lacks', () => {
    expect(eventFor(machine(LAPTOP, []), false, false)).toEqual(PANE_UNKNOWN)
    expect(eventFor(machine(LAPTOP, []), false, true)).toEqual(paneClosed(START))
    expect(eventFor(machine(LAPTOP, []), true, false)).toEqual(paneClosed(START))
  })

  it('names the machine going away before anything about its panes', () => {
    const row = agent('w1:p1', 'idle')
    const reconnectingLaptop = machine(LAPTOP, [row], { connection: 'reconnecting' })
    const offlineLaptop = machine(LAPTOP, [row], { connection: 'offline' })

    expect(eventFor(reconnectingLaptop)).toEqual(
      machineReconnecting(reconnectingLaptop.machine.connectionChangedAt),
    )
    expect(eventFor(offlineLaptop)).toEqual(
      machineOffline(offlineLaptop.machine.connectionChangedAt),
    )
  })

  it('knows nothing without a snapshot', () => {
    expect(presenceEventOf(Option.none(), LAPTOP, PANE, false, false)).toEqual(PANE_UNKNOWN)
  })
})
