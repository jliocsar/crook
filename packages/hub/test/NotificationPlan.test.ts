import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'

import { AgentRow, StatusBeforeHandoff } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { HerdrLink } from '@crook/domain/HerdrLink'
import {
  HerdrConnectionId,
  MachineId,
  PaneId,
  TabId,
  TerminalId,
  WorkspaceId,
} from '@crook/domain/Ids'
import { MachineState, MachineStateVersion } from '@crook/domain/MachineState'
import { defaultNotificationPrefs } from '@crook/domain/Notifications'
import { Workspace } from '@crook/domain/Workspace'
import { HarkNotificationId } from '@crook/hub/HarkClient'
import {
  NotificationStep,
  SentNotification,
  WantedNotification,
  afterForgotten,
  afterPublish,
  afterSeen,
  harkTitleOf,
  idempotencyKeyOf,
  isStillWanted,
  nextStep,
  notificationKey,
  raisedBetween,
} from '@crook/hub/NotificationPlan'

const LAPTOP = MachineId.make('laptop')
const PANE = PaneId.make('w1:p1')
const TERMINAL = TerminalId.make('term_1')
const AFTER_HANDOFF = TerminalId.make('term_2')
const TITLE = 'EX-253 Example feature'
const HARK_TITLE_LIMIT = 80

const rowWith = (
  status: AgentStatus,
  stateChangeSeq: number,
  fields: Partial<ConstructorParameters<typeof AgentRow>[0]> = {},
) =>
  new AgentRow({
    pane: PANE,
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    terminal: TERMINAL,
    status,
    title: TITLE,
    label: Option.none(),
    createdByCrook: false,
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq,
    statusChangedAt: DateTime.makeUnsafe(0),
    beforeHandoff: Option.none(),
    ...fields,
  })

const handedOff = (status: AgentStatus, stateChangeSeq: number, before: AgentStatus) =>
  rowWith(status, stateChangeSeq, {
    terminal: AFTER_HANDOFF,
    beforeHandoff: Option.some(
      new StatusBeforeHandoff({
        status: before,
        statusChangedAt: DateTime.makeUnsafe(0),
        terminal: TERMINAL,
        stateChangeSeq: 7,
      }),
    ),
  })

const stateWith = (
  agents: readonly AgentRow[],
  herdr: { readonly connection?: number; readonly lost?: boolean } = {},
) =>
  new MachineState({
    machine: LAPTOP,
    version: MachineStateVersion.make(1),
    herdrVersion: '0.9.5',
    herdr: new HerdrLink({
      connection: HerdrConnectionId.make(herdr.connection ?? 1),
      lostAt: herdr.lost === true ? Option.some(DateTime.makeUnsafe(0)) : Option.none(),
    }),
    workspaces: [new Workspace({ id: WorkspaceId.make('w1'), label: 'crook' })],
    tabs: [],
    panes: [],
    agents,
  })

const FINISHED_FIELDS: ConstructorParameters<typeof WantedNotification>[0] = {
  machine: LAPTOP,
  pane: PANE,
  event: 'finished',
  terminal: TERMINAL,
  stateChangeSeq: 7,
  title: TITLE,
  body: 'Finished · laptop / crook',
}

const finished = new WantedNotification(FINISHED_FIELDS)

const noneSeen = HashSet.empty<PaneId>()

describe('raisedBetween', () => {
  it('raises Finished and Has a question, titled by the agent and placed by machine and workspace', () => {
    const done = raisedBetween(
      stateWith([rowWith('working', 6)]),
      stateWith([rowWith('done', 7)]),
      'laptop',
    )
    const asked = raisedBetween(
      stateWith([rowWith('working', 6)]),
      stateWith([rowWith('blocked', 7, { label: Option.some('notes') })]),
      'desk',
    )

    expect(done).toEqual([finished])
    expect(asked).toEqual([
      new WantedNotification({
        ...FINISHED_FIELDS,
        event: 'questions',
        title: 'notes',
        body: 'Has a question · desk / crook',
      }),
    ])
  })

  it('raises nothing across a resync, while herdr is lost, or for a status that did not change', () => {
    const working = stateWith([rowWith('working', 6)])

    expect(
      raisedBetween(working, stateWith([rowWith('done', 7)], { connection: 2 }), 'laptop'),
    ).toEqual([])
    expect(
      raisedBetween(working, stateWith([rowWith('done', 7)], { lost: true }), 'laptop'),
    ).toEqual([])
    expect(
      raisedBetween(
        stateWith([rowWith('blocked', 6)]),
        stateWith([rowWith('blocked', 7)]),
        'laptop',
      ),
    ).toEqual([])
    expect(raisedBetween(stateWith([]), stateWith([rowWith('done', 1)]), 'laptop')).toEqual([])
    expect(
      raisedBetween(stateWith([rowWith('unknown', 0)]), stateWith([rowWith('done', 1)]), 'laptop'),
    ).toEqual([])
  })

  it('judges a handoff re-detection against the status from before the handoff', () => {
    const redetecting = stateWith([handedOff('unknown', 1, 'working')])
    const stillDone = stateWith([handedOff('done', 2, 'done')])

    expect(
      raisedBetween(
        redetecting,
        stateWith([rowWith('done', 2, { terminal: AFTER_HANDOFF })]),
        'laptop',
      ),
    ).toEqual([
      new WantedNotification({ ...FINISHED_FIELDS, terminal: AFTER_HANDOFF, stateChangeSeq: 2 }),
    ])
    expect(
      raisedBetween(stateWith([handedOff('unknown', 1, 'done')]), stillDone, 'laptop'),
    ).toEqual([])
  })
})

describe('isStillWanted', () => {
  it('keeps a notification while the agent stays where it was, or is not known yet', () => {
    expect(isStillWanted(finished, stateWith([rowWith('done', 7)]), noneSeen)).toBe(true)
    expect(isStillWanted(finished, stateWith([rowWith('unknown', 1)]), noneSeen)).toBe(true)
    expect(isStillWanted(finished, stateWith([], { lost: true }), noneSeen)).toBe(true)
    expect(isStillWanted(finished, stateWith([handedOff('done', 2, 'done')]), noneSeen)).toBe(true)
  })

  it('drops it once the state moves on, the agent is gone or the pane was seen in crook', () => {
    expect(isStillWanted(finished, stateWith([rowWith('idle', 7)]), noneSeen)).toBe(false)
    expect(isStillWanted(finished, stateWith([rowWith('done', 9)]), noneSeen)).toBe(false)
    expect(isStillWanted(finished, stateWith([]), noneSeen)).toBe(false)
    expect(isStillWanted(finished, stateWith([rowWith('done', 7)]), HashSet.make(PANE))).toBe(false)
  })
})

describe('afterPublish and afterSeen', () => {
  it('raises only the events whose switch is on, and drops what was seen', () => {
    const change = {
      machineLabel: 'laptop',
      previous: Option.some(stateWith([rowWith('working', 6)])),
      next: stateWith([rowWith('done', 7)]),
      seen: noneSeen,
    }
    const raised = afterPublish(HashMap.empty(), change, defaultNotificationPrefs)
    const muted = afterPublish(HashMap.empty(), change, {
      ...defaultNotificationPrefs,
      finished: false,
    })

    expect(HashMap.toValues(raised)).toEqual([finished])
    expect(HashMap.size(muted)).toBe(0)
    expect(HashMap.size(afterSeen(raised, LAPTOP, PANE))).toBe(0)
  })

  it('drops every notification of a machine forgotten from the herd, and only those', () => {
    const desk = new WantedNotification({ ...FINISHED_FIELDS, machine: MachineId.make('desk') })
    const wanted = HashMap.make(
      [notificationKey(finished), finished],
      [notificationKey(desk), desk],
    )

    expect(HashMap.toValues(afterForgotten(wanted, LAPTOP))).toEqual([desk])
  })
})

describe('nextStep', () => {
  const sentFinished = new SentNotification({
    ...FINISHED_FIELDS,
    harkId: HarkNotificationId.make('anot_1'),
  })
  const wanted = HashMap.make([notificationKey(finished), finished])
  const sent = HashMap.make([notificationKey(sentFinished), sentFinished])

  it('sends what is wanted, withdraws what is not, and drops what was switched off', () => {
    expect(nextStep(wanted, HashMap.empty(), HashSet.empty(), defaultNotificationPrefs)).toEqual(
      Option.some(NotificationStep.Send({ wanted: finished })),
    )
    expect(nextStep(HashMap.empty(), sent, HashSet.empty(), defaultNotificationPrefs)).toEqual(
      Option.some(NotificationStep.Withdraw({ sent: sentFinished })),
    )
    expect(
      nextStep(wanted, HashMap.empty(), HashSet.empty(), {
        ...defaultNotificationPrefs,
        finished: false,
      }),
    ).toEqual(Option.some(NotificationStep.Drop({ wanted: finished })))
    expect(nextStep(wanted, sent, HashSet.empty(), defaultNotificationPrefs)).toEqual(Option.none())
  })
})

describe('copy limits', () => {
  it('cuts a title to Hark limit without splitting a character, and keys by the state', () => {
    const long = `${'a'.repeat(HARK_TITLE_LIMIT - 1)}😀`

    expect(harkTitleOf(long)).toBe('a'.repeat(HARK_TITLE_LIMIT - 1))
    expect(harkTitleOf(TITLE)).toBe(TITLE)
    expect(idempotencyKeyOf(finished)).toEqual(Option.some('crook/laptop/w1:p1/term_1/7/finished'))
  })
})
