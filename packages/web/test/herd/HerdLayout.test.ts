import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'

import { findAgent, herdLayout, SectionBody } from '@crook/web/herd/HerdLayout'
import type { MachineSectionModel } from '@crook/web/herd/HerdLayout'

import { agent, DESK, herd, LAPTOP, machine, START } from '../HerdFixtures.ts'

const cardPanes = (section: MachineSectionModel | undefined) =>
  section === undefined
    ? []
    : SectionBody.$match(section.body, {
        Agents: ({ agents }) => agents.map((card) => card.row.pane),
        NoAgents: () => [],
        AgentsUnseen: () => [],
        Offline: () => [],
      })

const bodyKind = (section: MachineSectionModel | undefined) =>
  section === undefined
    ? 'missing'
    : SectionBody.$match(section.body, {
        Agents: () => 'agents',
        NoAgents: () => 'noAgents',
        AgentsUnseen: () => 'agentsUnseen',
        Offline: () => 'offline',
      })

describe('herdLayout', () => {
  it('orders each machine by priority and counts who needs you', () => {
    const layout = herdLayout(
      herd([
        machine(LAPTOP, [
          agent('w1:p1', 'working'),
          agent('w1:p2', 'done', { secondsAgo: 30 }),
          agent('w1:p3', 'blocked', { secondsAgo: 10 }),
          agent('w1:p4', 'done', { secondsAgo: 5 }),
        ]),
      ]),
    )
    const [laptop] = layout.sections

    expect(layout.notice).toEqual(Option.none())
    expect(cardPanes(laptop)).toEqual(['w1:p3', 'w1:p4', 'w1:p2', 'w1:p1'])
    expect(laptop?.needsYou).toBe(3)
  })

  it('names the workspace and tab, and marks only the loud cards', () => {
    const [laptop] = herdLayout(
      herd([machine(LAPTOP, [agent('w1:p1', 'working'), agent('w1:p2', 'blocked')])]),
    ).sections
    const cards =
      laptop === undefined
        ? []
        : SectionBody.$match(laptop.body, {
            Agents: ({ agents }) => agents,
            NoAgents: () => [],
            AgentsUnseen: () => [],
            Offline: () => [],
          })

    expect(cards.map((card) => [card.workspace, card.tab, card.needsYou])).toEqual([
      ['crook', 'web', true],
      ['crook', 'web', false],
    ])
  })

  it('says nothing is running when no machine has an agent', () => {
    const layout = herdLayout(herd([machine(LAPTOP, []), machine(DESK, [])]))

    expect(layout.notice).toEqual(Option.some('nothingRunning'))
    expect(layout.sections.map(bodyKind)).toEqual(['agents', 'agents'])
  })

  it('says no agents under an empty machine next to a busy one', () => {
    const layout = herdLayout(herd([machine(LAPTOP, [agent('w1:p1', 'idle')]), machine(DESK, [])]))

    expect(layout.notice).toEqual(Option.none())
    expect(layout.sections.map(bodyKind)).toEqual(['agents', 'noAgents'])
  })

  it('hides an offline machine behind one line and ignores it in the count', () => {
    const layout = herdLayout(
      herd([
        machine(LAPTOP, [agent('w1:p1', 'blocked')]),
        machine(DESK, [agent('w1:p1', 'blocked')], { connection: 'offline' }),
      ]),
    )

    expect(layout.sections.map(bodyKind)).toEqual(['agents', 'offline'])
    expect(layout.sections.map((section) => section.needsYou)).toEqual([1, 0])
  })

  it('says when every machine is offline, and when there are none', () => {
    expect(herdLayout(herd([machine(LAPTOP, [], { connection: 'offline' })])).notice).toEqual(
      Option.some('allOffline'),
    )
    expect(herdLayout(herd([])).notice).toEqual(Option.some('noMachines'))
  })

  it('says nothing is running only when no machine with nothing to show has lost herdr', () => {
    const lost = machine(LAPTOP, [], { herdrLostAt: START })
    const empty = machine(DESK, [])
    const offline = machine(DESK, [], { connection: 'offline' })

    const shape = (machines: Parameters<typeof herd>[0]) => {
      const layout = herdLayout(herd(machines))

      return [layout.notice, layout.sections.map(bodyKind)]
    }

    expect(shape([lost])).toEqual([Option.none(), ['agentsUnseen']])
    expect(shape([lost, machine(DESK, [], { herdrLostAt: START })])).toEqual([
      Option.none(),
      ['agentsUnseen', 'agentsUnseen'],
    ])
    expect(shape([lost, empty])).toEqual([Option.none(), ['agentsUnseen', 'noAgents']])
    expect(shape([lost, offline])).toEqual([Option.none(), ['agentsUnseen', 'offline']])
    expect(shape([lost, machine(DESK, [agent('w2:p1', 'idle')])])).toEqual([
      Option.none(),
      ['agentsUnseen', 'agents'],
    ])
    expect(
      shape([machine(LAPTOP, [], { connection: 'offline', herdrLostAt: START }), empty]),
    ).toEqual([Option.some('nothingRunning'), ['offline', 'agents']])
  })

  it('keeps a lost machine lost and unseen through a reconnect', () => {
    const [section] = herdLayout(
      herd([machine(LAPTOP, [], { connection: 'reconnecting', herdrLostAt: START })]),
    ).sections

    expect(bodyKind(section)).toBe('agentsUnseen')
    expect(section?.herdrLostAt).toEqual(Option.some(START))
  })

  it('marks only the lost machine as lost, on its section and on its cards', () => {
    const layout = herdLayout(
      herd([
        machine(LAPTOP, [agent('w1:p1', 'working')], { herdrLostAt: START }),
        machine(DESK, [agent('w2:p1', 'working')]),
      ]),
    )
    const lostOnCards = layout.sections.map((section) =>
      SectionBody.$match(section.body, {
        Agents: ({ agents }) => agents.map((card) => card.herdrLostAt),
        NoAgents: () => [],
        AgentsUnseen: () => [],
        Offline: () => [],
      }),
    )

    expect(layout.sections.map((section) => section.herdrLostAt)).toEqual([
      Option.some(START),
      Option.none(),
    ])
    expect(lostOnCards).toEqual([[Option.some(START)], [Option.none()]])
  })

  it('finds one agent by machine and pane', () => {
    const idle = agent('w1:p1', 'idle')
    const view = herd([machine(LAPTOP, [idle])])

    expect(Option.map(findAgent(view, LAPTOP, idle.pane), ({ row }) => row.pane)).toEqual(
      Option.some(idle.pane),
    )
    expect(findAgent(view, DESK, idle.pane)).toEqual(Option.none())
  })
})
