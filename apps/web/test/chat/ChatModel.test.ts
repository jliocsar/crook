import { describe, expect, it } from 'vitest'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'

import type { AgentRow } from '@crook/domain/AgentRow'
import { HerdMachine } from '@crook/domain/HerdView'
import type { MachineConnection } from '@crook/domain/Machine'
import { PaneId } from '@crook/domain/Ids'
import { MachineState } from '@crook/domain/MachineState'
import { Pane } from '@crook/domain/Pane'
import { HerdSnapshot } from '@crook/web/cache/HerdCache'
import { activityEventOf, activityMachine, activityView } from '@crook/web/chat/ActivityMachine'
import {
  ChatStatus,
  chatScreenModel,
  chatStatus,
  edgeKindOf,
  endedAtOf,
  isWatching,
  LOADING_CHAT,
  withPresence,
} from '@crook/web/chat/ChatModel'
import {
  PANE_LIVE,
  presenceEventOf,
  presenceMachine,
  PresenceState,
  reconnecting,
} from '@crook/web/chat/PresenceMachine'
import type { ChatScreenModel } from '@crook/web/chat/ChatModel'

import { agent, CROOK_TAB, CROOK_WORKSPACE, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'

const PANE = PaneId.make('w1:p1')

const withShellPane = (entry: HerdMachine): HerdMachine =>
  new HerdMachine(
    Struct.evolve(entry, {
      state: (state) =>
        Option.map(
          state,
          (found) =>
            new MachineState(
              Struct.evolve(found, {
                panes: (panes) => [
                  ...panes,
                  new Pane({ id: PANE, workspace: CROOK_WORKSPACE, tab: CROOK_TAB }),
                ],
              }),
            ),
        ),
    }),
  )

const snapshot = (entry: HerdMachine, minutes = 0) =>
  Option.some(
    new HerdSnapshot({
      view: herd([entry]),
      syncedAt: DateTime.addDuration(START, Duration.minutes(minutes)),
    }),
  )

const laptop = (rows: readonly AgentRow[], connection: MachineConnection = 'online') =>
  machine(LAPTOP, rows, { connection })

const step = (previous: ChatScreenModel, entry: HerdMachine, minutes = 0): ChatScreenModel => {
  const herdNow = snapshot(entry, minutes)
  const seenBefore = Option.isSome(previous.row)
  const [presence] = presenceMachine.transition(
    previous.presence,
    presenceEventOf(herdNow, LAPTOP, PANE, seenBefore, true),
  )

  return chatScreenModel(herdNow, LAPTOP, PANE, previous, presence)
}

const activityFrom = (model: ChatScreenModel) =>
  activityMachine.transition(
    activityMachine.initial,
    activityEventOf(model.presence, model.row, Option.none()),
  )[0]

const statusOf = (model: ChatScreenModel) => chatStatus(model, activityFrom(model))

const itemActivityOf = (model: ChatScreenModel) => activityView(activityFrom(model)).itemActivity

const live = step(LOADING_CHAT, laptop([agent('w1:p1', 'working')]))

describe('chatScreenModel', () => {
  it('reads a pane with Claude as live, with its status, place and activity', () => {
    expect(PresenceState.guards.Live(live.presence)).toBe(true)
    expect(statusOf(live)).toStrictEqual(ChatStatus.Agent({ status: 'working' }))
    expect(itemActivityOf(live)).toBe('working')
    expect(live.workspaceLabel).toStrictEqual(Option.some('crook'))
  })

  it('tells an exited Claude from a closed pane, and keeps the row it last saw', () => {
    const exited = step(live, withShellPane(laptop([])), 1)
    const closed = step(exited, laptop([]), 2)

    expect(PresenceState.guards.Exited(exited.presence)).toBe(true)
    expect(PresenceState.guards.Closed(closed.presence)).toBe(true)
    expect(Option.map(closed.row, (row) => row.pane)).toStrictEqual(Option.some(PANE))
    expect(statusOf(closed)).toStrictEqual(ChatStatus.Ended({ label: 'closed' }))
    expect(itemActivityOf(closed)).toBe('still')
  })

  it('stamps when the agent ended once, not on every later snapshot', () => {
    const exited = step(live, withShellPane(laptop([])), 1)
    const later = step(exited, withShellPane(laptop([])), 7)

    expect(endedAtOf(later)).toStrictEqual(endedAtOf(exited))
    expect(endedAtOf(exited)).toStrictEqual(
      Option.some(DateTime.addDuration(START, Duration.minutes(1))),
    )
  })

  it('calls a pane it never saw Claude in not a Claude pane', () => {
    expect(
      PresenceState.guards.NotClaude(step(LOADING_CHAT, withShellPane(laptop([]))).presence),
    ).toBe(true)
  })

  it('keeps a redialing machine live-looking, with the agent still its status', () => {
    const quiet = step(live, laptop([agent('w1:p1', 'working')], 'reconnecting'))

    expect(PresenceState.guards.Redialing(quiet.presence)).toBe(true)
    expect(statusOf(quiet)).toStrictEqual(ChatStatus.Agent({ status: 'working' }))
    expect(itemActivityOf(quiet)).toBe('working')
    expect(Option.isNone(edgeKindOf(quiet))).toBe(true)
    expect(isWatching(quiet)).toBe(true)
  })

  it('says a machine is reconnecting without taking the dock', () => {
    const reconnectingLaptop = laptop([agent('w1:p1', 'working')], 'reconnecting')
    const said = withPresence(
      step(live, reconnectingLaptop),
      reconnecting(reconnectingLaptop.machine.connectionChangedAt),
    )

    expect(statusOf(said)).toStrictEqual(ChatStatus.Ended({ label: 'laptop reconnecting' }))
    expect(Option.isNone(edgeKindOf(said))).toBe(true)
    expect(isWatching(said)).toBe(true)
  })

  it('reads a machine already offline when the chat opens as away and keeps the row', () => {
    const away = step(LOADING_CHAT, laptop([agent('w1:p1', 'working')], 'offline'))

    expect(PresenceState.guards.Away(away.presence)).toBe(true)
    expect(Option.isSome(away.row)).toBe(true)
    expect(statusOf(away)).toStrictEqual(ChatStatus.Ended({ label: 'laptop offline' }))
    expect(edgeKindOf(away)).toStrictEqual(Option.some('away'))
    expect(itemActivityOf(away)).toBe('working')
  })

  it('keeps what it had while there is no snapshot', () => {
    expect(chatScreenModel(Option.none(), LAPTOP, PANE, live, PANE_LIVE)).toStrictEqual(live)
  })
})
