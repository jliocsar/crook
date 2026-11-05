import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'
import * as Struct from 'effect/Struct'

import { CrookVersion } from '@crook/domain/CrookVersion'
import { HerdMachine, HerdView } from '@crook/domain/HerdView'
import { HerdrLink } from '@crook/domain/HerdrLink'
import { MachineState } from '@crook/domain/MachineState'
import {
  aboutRows,
  agentsHeading,
  agentSummary,
  agentVersionText,
  connectionRow,
  herdrVersionText,
  keepWhileGone,
  machineDetail,
  machinesLayout,
  versionsLine,
} from '@crook/web/machines/MachineLayout'

import { agent, DESK, LAPTOP, machine, START } from '../HerdFixtures.ts'

const HUB = CrookVersion.make('0.1.0')

const viewOf = (machines: readonly HerdMachine[]) => new HerdView({ machines, hubVersion: HUB })

const laptop = machine(
  LAPTOP,
  [agent('w1:p1', 'blocked'), agent('w1:p2', 'working'), agent('w1:p3', 'done')],
  { agentVersion: '0.0.9', herdrVersion: '0.9.5' },
)

const desk = machine(DESK, [agent('w2:p1', 'blocked')], {
  connection: 'offline',
  agentVersion: '0.1.0',
})

const cardOf = (herdMachine: HerdMachine) =>
  Option.getOrThrow(Arr.head(machinesLayout(viewOf([herdMachine])).machines))

const FIVE_MINUTES_LATER = DateTime.addDuration(START, Duration.minutes(5))

const withHerdrLost = (herdMachine: HerdMachine) =>
  new HerdMachine(
    Struct.evolve(herdMachine, {
      state: Option.map(
        (state) =>
          new MachineState(
            Struct.evolve(state, {
              herdr: (link) =>
                new HerdrLink({ connection: link.connection, lostAt: Option.some(START) }),
            }),
          ),
      ),
    }),
  )

describe('machinesLayout', () => {
  it('gives one card per machine with its agents, who needs you and whether it is behind', () => {
    const layout = machinesLayout(viewOf([laptop, desk]))

    expect(
      layout.machines.map((card) => ({
        id: card.machine.id,
        agents: card.agents,
        needsYou: card.needsYou,
        behindHub: card.behindHub,
      })),
    ).toEqual([
      { id: LAPTOP, agents: 3, needsYou: 2, behindHub: true },
      { id: DESK, agents: 1, needsYou: 0, behindHub: false },
    ])
  })

  it('reads the counts as one line', () => {
    expect(agentSummary(cardOf(laptop))).toBe('3 agents · 2 need you')
    expect(agentSummary(cardOf(machine(LAPTOP, [agent('w1:p1', 'working')])))).toBe('1 agent')
    expect(agentSummary(cardOf(machine(LAPTOP, [])))).toBe('No agents')
  })

  it('lists the versions it knows and nothing when it knows none', () => {
    expect(versionsLine(laptop.machine)).toEqual(Option.some('agent 0.0.9 · herdr 0.9.5'))
    expect(versionsLine(desk.machine)).toEqual(Option.some('agent 0.1.0'))
    expect(versionsLine(machine(LAPTOP, []).machine)).toEqual(Option.none())
  })
})

describe('machine detail', () => {
  it('says how long a machine has been online, reconnecting, or since it was last seen', () => {
    const reconnecting = machine(LAPTOP, [], { connection: 'reconnecting' })

    expect(connectionRow(laptop.machine, FIVE_MINUTES_LATER)).toEqual({
      label: 'Online for',
      value: '5m',
      warn: false,
    })
    expect(connectionRow(reconnecting.machine, FIVE_MINUTES_LATER)).toEqual({
      label: 'Reconnecting for',
      value: '5m',
      warn: false,
    })
    expect(connectionRow(desk.machine, FIVE_MINUTES_LATER)).toEqual({
      label: 'Last seen',
      value: '2h ago',
      warn: false,
    })
  })

  it('names the hub version beside an agent that is behind it', () => {
    expect(agentVersionText(laptop.machine, HUB)).toBe('0.0.9, hub has 0.1.0')
    expect(agentVersionText(desk.machine, HUB)).toBe('0.1.0')
    expect(herdrVersionText(desk.machine)).toBe('unknown')
    expect(
      Option.flatMap(machineDetail(viewOf([laptop]), LAPTOP), (detail) =>
        Arr.get(aboutRows(detail, FIVE_MINUTES_LATER), 1),
      ),
    ).toEqual(Option.some({ label: 'crook agent', value: '0.0.9, hub has 0.1.0', warn: true }))
  })

  it('says herdr is lost on a machine that is online, and only there', () => {
    const herdrRowOf = (herdMachine: HerdMachine) =>
      Option.flatMap(machineDetail(viewOf([herdMachine]), herdMachine.machine.id), (detail) =>
        Arr.findFirst(aboutRows(detail, FIVE_MINUTES_LATER), (row) => row.label === 'Herdr'),
      )

    expect(cardOf(withHerdrLost(laptop)).herdrLostAt).toEqual(Option.some(START))
    expect(cardOf(laptop).herdrLostAt).toEqual(Option.none())
    expect(cardOf(withHerdrLost(desk)).herdrLostAt).toEqual(Option.none())
    expect(herdrRowOf(withHerdrLost(laptop))).toEqual(
      Option.some({ label: 'Herdr', value: 'lost for 5m', warn: true }),
    )
    expect(herdrRowOf(laptop)).toEqual(Option.some({ label: 'Herdr', value: '0.9.5', warn: false }))
  })

  it('hides the agents of an offline machine and counts the rest', () => {
    const heading = (herdMachine: HerdMachine) =>
      Option.map(machineDetail(viewOf([herdMachine]), herdMachine.machine.id), (detail) =>
        agentsHeading(detail.body),
      )

    expect(heading(laptop)).toEqual(Option.some('Agents · 3'))
    expect(heading(desk)).toEqual(Option.some('Agents · –'))
    expect(heading(machine(LAPTOP, []))).toEqual(Option.some('Agents · 0'))
    expect(machineDetail(viewOf([laptop]), DESK)).toEqual(Option.none())
  })

  it('keeps showing a machine that just left the herd', () => {
    const shown = keepWhileGone(machineDetail(viewOf([desk]), DESK), Option.none())
    const gone = keepWhileGone(Option.none(), shown)

    expect(Option.map(shown, (model) => model.inHerd)).toEqual(Option.some(true))
    expect(Option.map(gone, (model) => [model.inHerd, model.detail.card.machine.id])).toEqual(
      Option.some([false, DESK]),
    )
    expect(keepWhileGone(Option.none(), Option.none())).toEqual(Option.none())
  })
})
