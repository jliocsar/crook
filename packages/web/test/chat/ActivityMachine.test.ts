import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'

import { TranscriptOffset } from '@crook/domain/Ids'
import {
  CompactBoundaryBlock,
  LocalCommandBlock,
  SystemMessage,
  TextBlock,
} from '@crook/domain/TranscriptMessage'
import type { TranscriptMessage } from '@crook/domain/TranscriptMessage'
import {
  activityEventOf,
  activityMachine,
  activityView,
  AGENT_ASKS,
  AGENT_MISSING,
  agentWorks,
  answerLanded,
  away,
  BLOCKED,
  finished,
  lastTurnEvidence,
  machineAway,
  NO_AGENT,
  quietTurnOpen,
  quietTurnOver,
  runEventOf,
  sameActivity,
  STATUS_UNKNOWN,
  still,
  working,
} from '@crook/web/chat/ActivityMachine'
import type { ActivityEvent, ActivityState, TurnEvidence } from '@crook/web/chat/ActivityMachine'
import {
  AWAY,
  closed,
  exited,
  LOADING,
  NOT_CLAUDE,
  PANE_LIVE,
  redialing,
} from '@crook/web/chat/PresenceMachine'
import type { TranscriptLine } from '@crook/web/chat/TranscriptState'
import { walk } from '@crook/web/machine/Walk'

import { activityWalk } from '../../charts/ActivityWalk.ts'
import { agent, START } from '../HerdFixtures.ts'
import {
  answered,
  at,
  compactBoundary,
  compactSummary,
  prompt,
  SESSION,
  toolResult,
  toolUse,
  turnDuration,
  user,
} from '../TranscriptFixtures.ts'

const STARTED = DateTime.makeUnsafe('2026-10-20T12:00:00Z')
const LATER = DateTime.makeUnsafe('2026-10-20T12:00:30Z')
const EARLIER = DateTime.makeUnsafe('2026-10-20T11:59:00Z')

const evidence = (ends: boolean, stamped = LATER): Option.Option<TurnEvidence> =>
  Option.some({ ends, at: Option.some(stamped) })

const PREVIOUS_ANSWER = evidence(true, EARLIER)
const PROMPT = evidence(false)
const ANSWER = evidence(true)
const NO_EVIDENCE = Option.none<TurnEvidence>()

const after = (start: ActivityState, events: readonly ActivityEvent[]): ActivityState =>
  Arr.reduce(events, start, (state, event) => activityMachine.transition(state, event)[0])

const workingRow = Option.some(agent('w1:p1', 'working', { secondsAgo: 0 }))
const since = Option.getOrThrow(Option.map(workingRow, (row) => row.statusChangedAt))
const idleRow = Option.some(agent('w1:p1', 'idle'))
const doneRow = Option.some(agent('w1:p1', 'done'))
const blockedRow = Option.some(agent('w1:p1', 'blocked'))
const unknownRow = Option.some(agent('w1:p1', 'unknown'))
const justBefore = DateTime.subtract(since, { seconds: 1 })
const justAfter = DateTime.add(since, { seconds: 1 })

describe('the activity machine', () => {
  it('walks clean: every state reached, each can get back to idle', () => {
    expect(walk(activityWalk).findings).toEqual([])
  })

  it('stays far under the walk limit, since a flip time is not part of a state', () => {
    expect(walk(activityWalk).states).toHaveLength(10)
  })

  it('is one table for the row, Stop and Queued, the header word and the rows', () => {
    expect(activityView(working(STARTED))).toEqual({
      status: Option.some('working'),
      workingSince: Option.some(STARTED),
      itemActivity: 'working',
    })
    expect(activityView(finished(STARTED))).toEqual({
      status: Option.some('done'),
      workingSince: Option.none(),
      itemActivity: 'still',
    })
    expect(activityView(still('done')).status).toEqual(Option.some('done'))
    expect(activityView(BLOCKED).itemActivity).toBe('blocked')
    expect(activityView(away('working'))).toEqual({
      status: Option.none(),
      workingSince: Option.none(),
      itemActivity: 'working',
    })
    expect(activityView(NO_AGENT).status).toEqual(Option.none())
  })

  it('holds a turn it saw working after herdr goes quiet, and keeps its start', () => {
    expect(after(working(STARTED), [quietTurnOpen('idle')])).toEqual(working(STARTED))
    expect(after(working(STARTED), [quietTurnOpen('idle'), quietTurnOpen('done')])).toEqual(
      working(STARTED),
    )
  })

  it('holds nothing for a prompt landing after a turn ended, or its start would be the old one', () => {
    expect(after(finished(STARTED), [quietTurnOpen('idle')])).toEqual(still('idle'))
  })

  it('holds nothing for a chat opened on an idle agent whose transcript looks unfinished', () => {
    expect(after(NO_AGENT, [quietTurnOpen('idle')])).toEqual(still('idle'))
    expect(after(still('done'), [quietTurnOpen('idle')])).toEqual(still('idle'))
    expect(after(BLOCKED, [quietTurnOpen('idle')])).toEqual(still('idle'))
  })

  it('lets a turn end whichever of the answer and the idle flip comes first', () => {
    expect(after(working(STARTED), [answerLanded(STARTED), quietTurnOver('idle')])).toEqual(
      still('idle'),
    )
    expect(after(working(STARTED), [quietTurnOpen('idle'), quietTurnOver('idle')])).toEqual(
      still('idle'),
    )
  })

  it('starts a fresh turn on a new flip, and again when a line reopens an ended one', () => {
    expect(after(finished(STARTED), [agentWorks(LATER)])).toEqual(working(LATER))
    expect(after(finished(STARTED), [agentWorks(STARTED)])).toEqual(working(STARTED))
  })

  it('drops the turn when Claude asks, the machine leaves or the pane goes', () => {
    expect(after(working(STARTED), [AGENT_ASKS])).toEqual(BLOCKED)
    expect(after(working(STARTED), [machineAway('working')])).toEqual(away('working'))
    expect(after(working(STARTED), [AGENT_MISSING])).toEqual(NO_AGENT)
    expect(after(working(STARTED), [STATUS_UNKNOWN])).toEqual(still('unknown'))
  })

  it('tells two states apart by what they carry, a flip time included', () => {
    expect(sameActivity(working(STARTED), working(STARTED))).toBe(true)
    expect(sameActivity(working(STARTED), working(LATER))).toBe(false)
    expect(sameActivity(still('idle'), still('done'))).toBe(false)
  })
})

describe('what a pane says happened', () => {
  it('reads herdr working as the turn under way until the answer stamped after the flip', () => {
    expect(activityEventOf(PANE_LIVE, workingRow, NO_EVIDENCE)).toEqual(agentWorks(since))
    expect(activityEventOf(PANE_LIVE, workingRow, evidence(false, justAfter))).toEqual(
      agentWorks(since),
    )
    expect(activityEventOf(PANE_LIVE, workingRow, evidence(true, justBefore))).toEqual(
      agentWorks(since),
    )
    expect(activityEventOf(PANE_LIVE, workingRow, evidence(true, justAfter))).toEqual(
      answerLanded(since),
    )
  })

  it('reads herdr quiet by whether the transcript left the turn open', () => {
    expect(activityEventOf(PANE_LIVE, idleRow, PROMPT)).toEqual(quietTurnOpen('idle'))
    expect(activityEventOf(PANE_LIVE, doneRow, PROMPT)).toEqual(quietTurnOpen('done'))
    expect(activityEventOf(PANE_LIVE, idleRow, ANSWER)).toEqual(quietTurnOver('idle'))
    expect(activityEventOf(PANE_LIVE, doneRow, PREVIOUS_ANSWER)).toEqual(quietTurnOver('done'))
    expect(activityEventOf(PANE_LIVE, idleRow, NO_EVIDENCE)).toEqual(quietTurnOver('idle'))
  })

  it('hands the question and the unknown word straight through', () => {
    expect(activityEventOf(PANE_LIVE, blockedRow, PROMPT)).toEqual(AGENT_ASKS)
    expect(activityEventOf(PANE_LIVE, unknownRow, PROMPT)).toEqual(STATUS_UNKNOWN)
  })

  it('reads a machine on its way back the same as a live one', () => {
    expect(activityEventOf(redialing(START), workingRow, NO_EVIDENCE)).toEqual(agentWorks(since))
    expect(activityEventOf(LOADING, idleRow, NO_EVIDENCE)).toEqual(quietTurnOver('idle'))
  })

  it('remembers what a machine that left was doing, for its rows', () => {
    expect(activityEventOf(AWAY, workingRow, NO_EVIDENCE)).toEqual(machineAway('working'))
    expect(activityEventOf(AWAY, blockedRow, NO_EVIDENCE)).toEqual(machineAway('blocked'))
    expect(activityEventOf(AWAY, idleRow, NO_EVIDENCE)).toEqual(machineAway('still'))
    expect(activityEventOf(AWAY, Option.none(), NO_EVIDENCE)).toEqual(AGENT_MISSING)
  })

  it('has no agent once the pane ended or never ran Claude', () => {
    expect(activityEventOf(exited(START), idleRow, NO_EVIDENCE)).toEqual(AGENT_MISSING)
    expect(activityEventOf(closed(START), workingRow, NO_EVIDENCE)).toEqual(AGENT_MISSING)
    expect(activityEventOf(NOT_CLAUDE, Option.none(), NO_EVIDENCE)).toEqual(AGENT_MISSING)
    expect(activityEventOf(PANE_LIVE, Option.none(), NO_EVIDENCE)).toEqual(AGENT_MISSING)
  })
})

describe('what a subagent run says happened', () => {
  it('works from its start until its answer, and has no agent once it stops', () => {
    expect(runEventOf(Option.some(since), NO_EVIDENCE)).toEqual(agentWorks(since))
    expect(runEventOf(Option.some(since), evidence(false, justAfter))).toEqual(agentWorks(since))
    expect(runEventOf(Option.some(since), evidence(true, justAfter))).toEqual(answerLanded(since))
    expect(runEventOf(Option.none(), evidence(false, justAfter))).toEqual(AGENT_MISSING)
  })
})

describe('the transcript evidence of a turn', () => {
  const linesOf = (messages: readonly TranscriptMessage[]): readonly TranscriptLine[] =>
    messages.map((message) => ({ session: SESSION, message }))
  const ended = (messages: readonly TranscriptMessage[]) =>
    Option.map(lastTurnEvidence(linesOf(messages)), (found) => found.ends)

  it('reads a prompt and a tool as open, an answer and a turn duration as over', () => {
    expect(ended([prompt(0, 'Fix it')])).toEqual(Option.some(false))
    expect(ended([prompt(0, 'Fix it'), toolUse(10, 'toolu_a', 'Read', {})])).toEqual(
      Option.some(false),
    )
    expect(ended([toolResult(0, 'toolu_a', 'ok')])).toEqual(Option.some(false))
    expect(ended([answered(0, 'Fixed')])).toEqual(Option.some(true))
    expect(ended([prompt(0, 'Fix it'), turnDuration(10)])).toEqual(Option.some(true))
  })

  it('ends the turn of a typed /compact at its manual boundary', () => {
    expect(
      ended([
        prompt(0, '/compact'),
        compactBoundary(10),
        compactSummary(20, 'We fixed it.'),
        user(30, [new TextBlock({ text: 'caveat' })], { isMeta: true }),
        user(40, [new LocalCommandBlock({ name: '/compact', args: '' })]),
      ]),
    ).toEqual(Option.some(true))
  })

  it('opens a turn at a skill or a shell line, and at no other command', () => {
    expect(
      ended([
        answered(0, 'Fixed'),
        user(10, [new LocalCommandBlock({ name: '/skill', args: '', opensTurn: true })]),
        user(20, [new TextBlock({ text: 'the skill body' })], { isMeta: true }),
      ]),
    ).toEqual(Option.some(false))
    expect(
      ended([
        answered(0, 'Fixed'),
        user(10, [new LocalCommandBlock({ name: '/model', args: 'opus' })]),
      ]),
    ).toEqual(Option.some(true))
  })

  it('leaves a turn open across an automatic compaction, which it carries on from', () => {
    const automatic = new SystemMessage({
      offset: TranscriptOffset.make(10),
      uuid: Option.none(),
      timestamp: at(1),
      blocks: [
        new CompactBoundaryBlock({
          trigger: Option.some('auto'),
          tokensBefore: Option.none(),
          tokensAfter: Option.none(),
        }),
      ],
    })

    expect(ended([prompt(0, 'Fix it'), automatic])).toEqual(Option.some(false))
  })
})
