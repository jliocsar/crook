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
import {
  activityOf,
  ChatStatus,
  chatScreenModel,
  chatStatus,
  LOADING_CHAT,
} from '@crook/web/chat/ChatModel'
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

const step = (previous: ChatScreenModel, entry: HerdMachine, minutes = 0, stale = false) =>
  chatScreenModel(snapshot(entry, minutes), LAPTOP, PANE, previous, stale)

const live = step(LOADING_CHAT, laptop([agent('w1:p1', 'working')]))

describe('chatScreenModel', () => {
  it('reads a pane with Claude as live, with its status, place and activity', () => {
    expect(live.presence).toBe('live')
    expect(chatStatus(live)).toStrictEqual(ChatStatus.Agent({ status: 'working' }))
    expect(activityOf(live)).toBe('working')
    expect(live.workspaceLabel).toStrictEqual(Option.some('crook'))
  })

  it('tells an exited Claude from a closed pane, and keeps the row it last saw', () => {
    const exited = step(live, withShellPane(laptop([])), 1)
    const closed = step(exited, laptop([]), 2)

    expect(exited.presence).toBe('exited')
    expect(closed.presence).toBe('closed')
    expect(Option.map(closed.row, (row) => row.pane)).toStrictEqual(Option.some(PANE))
    expect(chatStatus(closed)).toStrictEqual(ChatStatus.Ended({ label: 'closed' }))
    expect(activityOf(closed)).toBe('still')
  })

  it('stamps when the agent ended once, not on every later snapshot', () => {
    const exited = step(live, withShellPane(laptop([])), 1)
    const later = step(exited, withShellPane(laptop([])), 7)

    expect(later.endedAt).toStrictEqual(exited.endedAt)
    expect(exited.endedAt).toStrictEqual(
      Option.some(DateTime.addDuration(START, Duration.minutes(1))),
    )
  })

  it('calls a pane it never saw Claude in not a Claude pane', () => {
    expect(step(LOADING_CHAT, withShellPane(laptop([]))).presence).toBe('notClaude')
  })

  it('reads a dropped machine as away and keeps the transcript row', () => {
    const away = step(live, laptop([agent('w1:p1', 'working')], 'offline'))

    expect(away.presence).toBe('away')
    expect(Option.isSome(away.row)).toBe(true)
    expect(chatStatus(away)).toStrictEqual(ChatStatus.Ended({ label: 'laptop offline' }))
  })

  it('keeps what the agent was doing while its machine is away', () => {
    const away = step(live, laptop([agent('w1:p1', 'working')], 'offline'))

    expect(activityOf(away)).toBe('working')
  })

  it('keeps what it had while there is no snapshot', () => {
    expect(chatScreenModel(Option.none(), LAPTOP, PANE, live, false)).toBe(live)
  })

  it('waits for the hub before calling a pane closed that only a stale herd lacks', () => {
    const cached = step(LOADING_CHAT, laptop([]), 0, true)
    const confirmed = step(cached, laptop([]))

    expect(cached.presence).toBe('loading')
    expect(confirmed.presence).toBe('closed')
  })

  it('still calls a pane closed while stale once it had seen Claude there', () => {
    expect(step(live, laptop([]), 1, true).presence).toBe('closed')
  })
})
