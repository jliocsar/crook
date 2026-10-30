import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as HashMap from 'effect/HashMap'
import * as HashSet from 'effect/HashSet'
import * as Option from 'effect/Option'

import { AgentRow, StatusBeforeHandoff } from '@crook/domain/AgentRow'
import type { AgentStatus } from '@crook/domain/AgentStatus'
import { MachineId, PaneId, TabId, TerminalId, WorkspaceId } from '@crook/domain/Ids'
import { defaultNotificationPrefs } from '@crook/domain/Notifications'
import { AskId } from '@crook/domain/Ids'
import { HarkId } from '@crook/hub/HarkClient'
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

import { bashAsk, crookWorkspace, herdrLinkOf, machineStateWith } from './Fixtures'

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
    ask: Option.none(),
    runningSubagents: Option.none(),
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
  machineStateWith(LAPTOP, 1, agents, {
    workspaces: [crookWorkspace],
    herdr: herdrLinkOf(
      herdr.connection ?? 1,
      herdr.lost === true ? Option.some(DateTime.makeUnsafe(0)) : Option.none(),
    ),
  })

const FINISHED_FIELDS: ConstructorParameters<typeof WantedNotification>[0] = {
  machine: LAPTOP,
  pane: PANE,
  event: 'finished',
  terminal: TERMINAL,
  stateChangeSeq: 7,
  ask: Option.none(),
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

  it('raises nothing across a resync, while herdr is lost, or for a state that did not change', () => {
    const working = stateWith([rowWith('working', 6)])

    expect(
      raisedBetween(working, stateWith([rowWith('done', 7)], { connection: 2 }), 'laptop'),
    ).toEqual([])
    expect(
      raisedBetween(working, stateWith([rowWith('done', 7)], { lost: true }), 'laptop'),
    ).toEqual([])
    expect(
      raisedBetween(
        stateWith([rowWith('blocked', 7)]),
        stateWith([rowWith('blocked', 7)]),
        'laptop',
      ),
    ).toEqual([])
    expect(raisedBetween(stateWith([]), stateWith([rowWith('done', 1)]), 'laptop')).toEqual([])
    expect(
      raisedBetween(stateWith([rowWith('unknown', 0)]), stateWith([rowWith('done', 1)]), 'laptop'),
    ).toEqual([])
  })

  it('raises again for a new state of the same status, as when the one between was never published', () => {
    const askedAgain = raisedBetween(
      stateWith([rowWith('blocked', 5)]),
      stateWith([rowWith('blocked', 7)]),
      'laptop',
    )
    const finishedAgain = raisedBetween(
      stateWith([rowWith('done', 5)]),
      stateWith([rowWith('done', 7)]),
      'laptop',
    )

    expect(askedAgain).toEqual([
      new WantedNotification({
        ...FINISHED_FIELDS,
        event: 'questions',
        body: 'Has a question · laptop / crook',
      }),
    ])
    expect(finishedAgain).toEqual([finished])
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
  it('raises what the publish brought, and drops what was seen', () => {
    const change = {
      machineLabel: 'laptop',
      previous: Option.some(stateWith([rowWith('working', 6)])),
      next: stateWith([rowWith('done', 7)]),
      seen: noneSeen,
    }
    const raised = afterPublish(HashMap.empty(), change)

    expect(HashMap.toValues(raised)).toEqual([finished])
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
    harkId: HarkId.make('anot_1'),
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

describe('approvals', () => {
  const blockedOnBash = (askId: string) =>
    rowWith('blocked', 7, { ask: Option.some(bashAsk(askId)) })
  const approval = new WantedNotification({
    ...FINISHED_FIELDS,
    event: 'approvals',
    ask: Option.some(AskId.make('toolu_1')),
    body: 'Wants to run Bash · laptop / crook',
  })

  it('raises a permission ask as an approval naming the tool and never the command', () => {
    const raised = raisedBetween(
      stateWith([rowWith('working', 6)]),
      stateWith([blockedOnBash('toolu_1')]),
      'laptop',
    )

    expect(raised).toEqual([approval])
    expect(idempotencyKeyOf(approval)).toEqual(
      Option.some('crook/laptop/w1:p1/term_1/7/approvals/toolu_1'),
    )
  })

  it('keeps an approval while the agent waits on it, seen in crook or not', () => {
    const waiting = stateWith([blockedOnBash('toolu_1')])
    const wanted = HashMap.make([notificationKey(approval), approval])

    expect(isStillWanted(approval, waiting, HashSet.make(PANE))).toBe(true)
    expect(HashMap.toValues(afterSeen(wanted, LAPTOP, PANE))).toEqual([approval])
  })

  it('replaces an approval once the agent asks something else under the same state', () => {
    const replaced = afterPublish(HashMap.make([notificationKey(approval), approval]), {
      machineLabel: 'laptop',
      previous: Option.some(stateWith([blockedOnBash('toolu_1')])),
      next: stateWith([blockedOnBash('toolu_2')]),
      seen: noneSeen,
    })

    expect(isStillWanted(approval, stateWith([blockedOnBash('toolu_2')]), noneSeen)).toBe(false)
    expect(isStillWanted(approval, stateWith([rowWith('working', 8)]), noneSeen)).toBe(false)
    expect(HashMap.toValues(replaced)).toEqual([
      new WantedNotification({
        ...FINISHED_FIELDS,
        event: 'approvals',
        ask: Option.some(AskId.make('toolu_2')),
        body: 'Wants to run Bash · laptop / crook',
      }),
    ])
  })

  it('drops an approval whose switch is off', () => {
    expect(
      nextStep(
        HashMap.make([notificationKey(approval), approval]),
        HashMap.empty(),
        HashSet.empty(),
        { ...defaultNotificationPrefs, approvals: false },
      ),
    ).toEqual(Option.some(NotificationStep.Drop({ wanted: approval })))
  })
})
