import { describe, expect, it } from '@effect/vitest'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import { TranscriptOffset } from '@crook/domain/Ids'
import {
  omittedBetween,
  omittedUpTo,
  SkillsChanged,
  TranscriptChunk,
  TranscriptTailBytes,
} from '@crook/domain/Transcript'
import { OmittedLines } from '@crook/domain/TranscriptMessage'
import { TranscriptReadFailed, TranscriptResumeRejected } from '@crook/protocol/Transcripts'
import {
  afterAll,
  attemptOf,
  cacheRead,
  EARLIER_ASKED,
  emptyDue,
  eventArrived,
  failureOf,
  foldOf,
  isLoadingEarlier,
  isRetrying,
  NO_VIEW,
  noticeDue,
  noticeHeld,
  rememberedOf,
  sameOnScreen,
  saysCatchingUp,
  shownOf,
  threadSessionOf,
  TranscriptCommand,
  TranscriptViewState,
  watchFailed,
  watchResumed,
} from '@crook/web/chat/TranscriptMachine'
import type { TranscriptViewEvent } from '@crook/web/chat/TranscriptMachine'
import {
  applyTranscriptEvent,
  EMPTY_TRANSCRIPT,
  LaptopCatchUp,
  linesOf,
  resumeOf,
  type TranscriptLine,
} from '@crook/web/chat/TranscriptState'
import { caseName } from '@crook/web/machine/Machine'
import { walk } from '@crook/web/machine/Walk'

import { transcriptWalk } from '../../charts/TranscriptWalk.ts'
import {
  caughtUp,
  chunk,
  NEXT_SESSION,
  opened,
  prompt,
  said,
  SESSION,
} from '../TranscriptFixtures.ts'

const READ_FAILED = new TranscriptReadFailed({ detail: 'disk unplugged' })
const REJECTED = new TranscriptResumeRejected({ detail: 'the file shrank' })
const TAIL_START = TranscriptOffset.make(4096)
const ANY_TAIL = TranscriptTailBytes.make(1)

const SEEN = Arr.reduce(
  [opened(), chunk(0, 10, [prompt(0, 'hi')]), caughtUp(10)],
  EMPTY_TRANSCRIPT,
  applyTranscriptEvent,
)

const NEWER = chunk(10, 20, [said(10, 'hello')])

const after = (
  events: readonly TranscriptViewEvent[],
  start: TranscriptViewState = NO_VIEW,
): TranscriptViewState => afterAll(start, events)[0]

const commandsAfter = (
  events: readonly TranscriptViewEvent[],
  start: TranscriptViewState = NO_VIEW,
): readonly TranscriptCommand[] => afterAll(start, events)[1]

const nameOf = (state: TranscriptViewState) => caseName(TranscriptViewState, state)

const offsets = (lines: readonly TranscriptLine[]) =>
  Arr.map(lines, ({ message }) => message.offset)

const shownOffsets = (state: TranscriptViewState) => offsets(linesOf(shownOf(state)))

const reopened = after([cacheRead(Option.some(SEEN))])

const resumedCurrent = after(
  [
    eventArrived(opened()),
    eventArrived(chunk(0, 10, [prompt(0, 'hi')])),
    eventArrived(caughtUp(10)),
  ],
  after([watchResumed(true)]),
)

const noticed = (state: TranscriptViewState) => after([noticeDue(attemptOf(state))], state)

describe('the transcript machine', () => {
  it('walks clean: every state reached, nothing trapped, every rule held', () => {
    const walked = walk(transcriptWalk)

    expect(walked.findings).toEqual([])
  })

  it('stays under the guard of 256 states, since no token sits in its identity', () => {
    expect(walk(transcriptWalk).states.length).toBeLessThan(256)
  })
})

describe('the first read of a chat', () => {
  it('shows nothing until a current agent has caught up, then the whole read at once', () => {
    const partway = after([
      watchResumed(true),
      eventArrived(opened()),
      eventArrived(chunk(0, 10, [prompt(0, 'hi')])),
    ])

    expect(nameOf(partway)).toBe('NoView')
    expect(shownOf(partway)).toEqual(Option.none())

    const done = after([eventArrived(caughtUp(10))], partway)

    expect(nameOf(done)).toBe('Current')
    expect(shownOffsets(done)).toEqual([0])
    expect(rememberedOf(done)).toEqual(shownOf(done))
  })

  it('says No messages yet once a current agent has caught up on nothing', () => {
    expect(
      nameOf(after([watchResumed(true), eventArrived(opened()), eventArrived(caughtUp(0))])),
    ).toBe('OpenedEmpty')
  })

  it('waits for the first chunk of an agent too old for marks, not on its open', () => {
    const open = after([watchResumed(false), eventArrived(opened())])

    expect(nameOf(open)).toBe('NoView')
    expect(commandsAfter([eventArrived(opened())], after([watchResumed(false)]))).toEqual([
      TranscriptCommand.WaitOutEmpty({ attempt: 1 }),
    ])
    expect(nameOf(after([eventArrived(chunk(0, 10, [prompt(0, 'hi')]))], open))).toBe('Current')
  })

  it('says No messages yet for such an agent only once its wait has passed', () => {
    const open = after([watchResumed(false), eventArrived(opened())])

    expect(nameOf(after([emptyDue(attemptOf(open) + 1)], open))).toBe('NoView')
    expect(nameOf(after([emptyDue(attemptOf(open))], open))).toBe('OpenedEmpty')
  })
})

describe('a reopened chat', () => {
  it('shows its cache and waits on no timer before any watch runs', () => {
    expect(nameOf(reopened)).toBe('Cached')
    expect(shownOffsets(reopened)).toEqual([0])
    expect(commandsAfter([cacheRead(Option.some(SEEN))])).toEqual([])
  })

  it('holds what it reads and says nothing until the delay passes', () => {
    const resuming = after([watchResumed(true)], reopened)
    const reading = after([eventArrived(opened()), eventArrived(NEWER)], resuming)

    expect(nameOf(reading)).toBe('Holding')
    expect(saysCatchingUp(reading)).toBe(false)
    expect(shownOffsets(reading)).toEqual([0])
    expect(offsets(foldOf(reading).lines)).toEqual([0, 10])
    expect(commandsAfter([watchResumed(true)], reopened)).toEqual([
      TranscriptCommand.WaitOutNotice({ attempt: 1 }),
    ])
  })

  it('never says anything when the read ends before the delay', () => {
    const done = after(
      [watchResumed(true), eventArrived(NEWER), eventArrived(caughtUp(20))],
      reopened,
    )

    expect(nameOf(done)).toBe('Current')
    expect(saysCatchingUp(after([noticeDue(1)], done))).toBe(false)
  })

  it('says so after the delay, and a stale wait from an older attempt does not', () => {
    const once = after([watchResumed(true)], reopened)
    const twice = after([watchResumed(true)], once)

    expect(saysCatchingUp(after([noticeDue(attemptOf(once))], twice))).toBe(false)
    expect(nameOf(noticed(twice))).toBe('CatchingUp')
  })

  it('keeps the words up for their hold when the read ends first, with the rows landed', () => {
    const saying = noticed(after([watchResumed(true), eventArrived(NEWER)], reopened))
    const leaving = after([eventArrived(caughtUp(20))], saying)

    expect(nameOf(leaving)).toBe('NoticeLeaving')
    expect(saysCatchingUp(leaving)).toBe(true)
    expect(shownOffsets(leaving)).toEqual([0, 10])
    expect(nameOf(after([noticeHeld(attemptOf(leaving))], leaving))).toBe('Current')
  })

  it('lets the words leave with the rows once they have held', () => {
    const saying = noticed(after([watchResumed(true), eventArrived(NEWER)], reopened))
    const held = after([noticeHeld(attemptOf(saying))], saying)

    expect(nameOf(after([eventArrived(caughtUp(20))], held))).toBe('Current')
  })

  it('lands only a read that extends the cache, as a catch-up with its lapse', () => {
    const done = after(
      [watchResumed(true), eventArrived(NEWER), eventArrived(caughtUp(20))],
      reopened,
    )

    expect(Option.exists(shownOf(done), (view) => LaptopCatchUp.$is('Landed')(view.catchUp))).toBe(
      true,
    )
  })

  it('lands nothing when a read adds no line', () => {
    const done = after([watchResumed(true), eventArrived(caughtUp(10))], reopened)

    expect(Option.exists(shownOf(done), (view) => LaptopCatchUp.$is('None')(view.catchUp))).toBe(
      true,
    )
  })

  it('does not judge a catch-up for an agent too old to mark its end', () => {
    const open = after([watchResumed(false)], reopened)

    expect(nameOf(open)).toBe('Current')
    expect(Option.exists(shownOf(open), (view) => LaptopCatchUp.$is('None')(view.catchUp))).toBe(
      true,
    )
  })
})

describe('a resume over a gap too big for one read', () => {
  const GAP_END = TranscriptOffset.make(20_000_000)

  const skipped = omittedBetween(SESSION, TranscriptOffset.make(10), GAP_END)
  const overTheGap = new TranscriptChunk({
    session: SESSION,
    offset: skipped.offset,
    nextOffset: TranscriptOffset.make(20_000_010),
    messages: [...skipped.messages, said(20_000_000, 'the tail')],
  })

  const holding = after([watchResumed(true)], reopened)
  const landed = after([eventArrived(overTheGap), eventArrived(caughtUp(20_000_010))], holding)

  it('holds the skip back behind the cached rows, like any chunk', () => {
    const reading = after([eventArrived(overTheGap)], holding)

    expect(nameOf(reading)).toBe('Holding')
    expect(shownOffsets(reading)).toEqual([0])
    expect(saysCatchingUp(reading)).toBe(false)
  })

  it('lands the cached rows, the hole and the tail as one catch-up', () => {
    expect(nameOf(landed)).toBe('Current')
    expect(shownOffsets(landed)).toEqual([0, 10, 20_000_000])
    expect(LaptopCatchUp.$is('Landed')(foldOf(landed).catchUp)).toBe(true)
    expect(rememberedOf(landed)).toEqual(Option.some(foldOf(landed)))
  })

  it('restarts from nothing without a tail when Show earlier is pressed at the hole', () => {
    const asking = after([EARLIER_ASKED], landed)

    expect(isLoadingEarlier(asking)).toBe(true)
    expect(shownOffsets(asking)).toEqual([0, 10, 20_000_000])
    expect(resumeOf(foldOf(asking), Option.some(ANY_TAIL))).toEqual({
      from: Option.none(),
      tail: Option.none(),
    })
  })

  it('fills the hole in one commit, each row once, when the whole read has ended', () => {
    const reading = after(
      [
        EARLIER_ASKED,
        watchResumed(true),
        eventArrived(opened()),
        eventArrived(
          chunk(0, 20_000_010, [prompt(0, 'hi'), said(10, 'gap'), said(20_000_000, 'the tail')]),
        ),
      ],
      landed,
    )
    const filled = after([eventArrived(caughtUp(20_000_010))], reading)

    expect(isLoadingEarlier(reading)).toBe(true)
    expect(shownOffsets(reading)).toEqual([0, 10, 20_000_000])
    expect(nameOf(filled)).toBe('Current')
    expect(shownOffsets(filled)).toEqual([0, 10, 20_000_000])
    expect(
      Arr.some(linesOf(shownOf(filled)), ({ message }) => Schema.is(OmittedLines)(message)),
    ).toBe(false)
  })

  it('goes back to the tail when the session changes during Show earlier', () => {
    const moved = after(
      [EARLIER_ASKED, watchResumed(true), eventArrived(opened(NEXT_SESSION))],
      landed,
    )

    expect(nameOf(moved)).toBe('NoView')
    expect(resumeOf(foldOf(moved), Option.some(ANY_TAIL))).toEqual({
      from: Option.none(),
      tail: Option.some(ANY_TAIL),
    })
  })
})

describe('a session opening', () => {
  it('drops the old rows at once while the new session is read, so they never linger', () => {
    const reading = after([watchResumed(true), eventArrived(opened(NEXT_SESSION))], reopened)

    expect(nameOf(reading)).toBe('NoView')
    expect(shownOf(reading)).toEqual(Option.none())
    expect(threadSessionOf(reading)).toEqual(Option.some(NEXT_SESSION))
  })

  it('moves from a live thread to the next session in one message, with no empty step', () => {
    const next = after(
      [
        eventArrived(opened(NEXT_SESSION)),
        eventArrived(chunk(0, 10, [prompt(0, 'fresh')], NEXT_SESSION)),
        eventArrived(caughtUp(10, NEXT_SESSION)),
      ],
      resumedCurrent,
    )

    expect(nameOf(next)).toBe('Current')
    expect(threadSessionOf(next)).toEqual(Option.some(NEXT_SESSION))
    expect(shownOffsets(next)).toEqual([0])
  })

  it('keeps the skills of the pane across it', () => {
    const reading = after([eventArrived(opened(NEXT_SESSION))], resumedCurrent)

    expect(foldOf(reading).skills).toEqual(foldOf(resumedCurrent).skills)
  })
})

describe('a rejected resume', () => {
  it('keeps the rows while the file is read again from its start', () => {
    const rejected = after([watchFailed(REJECTED)], resumedCurrent)

    expect(nameOf(rejected)).toBe('Holding')
    expect(shownOffsets(rejected)).toEqual([0])
    expect(foldOf(rejected).position).toEqual(Option.none())
    expect(failureOf(rejected)).toEqual(Option.none())
  })

  it('keeps the rows for an agent too old for marks too, up to its first chunk', () => {
    const start = after([
      watchResumed(false),
      eventArrived(opened()),
      eventArrived(chunk(0, 10, [prompt(0, 'hi')])),
    ])
    const again = after([watchFailed(REJECTED), watchResumed(false), eventArrived(opened())], start)

    expect(nameOf(again)).toBe('Holding')
    expect(shownOffsets(again)).toEqual([0])
    expect(nameOf(after([emptyDue(attemptOf(again))], again))).toBe('Holding')

    const landed = after([eventArrived(chunk(0, 5, [said(0, 'rewritten')]))], again)

    expect(nameOf(landed)).toBe('Current')
    expect(offsets(foldOf(landed).lines)).toEqual([0])
  })

  it('fails outright when there was no position to resume from', () => {
    expect(nameOf(after([watchResumed(true), watchFailed(REJECTED)]))).toBe('Failed')
  })
})

describe('a restart under way', () => {
  const whole = after([
    watchResumed(true),
    eventArrived(opened()),
    eventArrived(omittedUpTo(SESSION, TAIL_START)),
    eventArrived(chunk(4096, 4106, [said(4096, 'tail')])),
    eventArrived(caughtUp(4106)),
    EARLIER_ASKED,
  ])

  it('ignores the failure of the watch it is leaving', () => {
    expect(after([watchFailed(READ_FAILED)], whole)).toBe(whole)
  })
})

describe('a rejected resume while the words show', () => {
  const held = after([watchResumed(true)], reopened)
  const saying = after([noticeDue(attemptOf(held))], held)

  it('keeps saying them, rather than dropping them and saying them again', () => {
    expect(saysCatchingUp(after([watchFailed(REJECTED)], saying))).toBe(true)
  })
})

describe('Show earlier with nothing shown', () => {
  it('changes nothing', () => {
    const empty = after([cacheRead(Option.some(EMPTY_TRANSCRIPT))])

    expect(after([EARLIER_ASKED], empty)).toBe(empty)
  })
})

describe('a failed watch', () => {
  it('keeps what it holds and is not catching up', () => {
    const failed = after(
      [watchResumed(true), eventArrived(NEWER), watchFailed(READ_FAILED)],
      noticed(after([watchResumed(true)], reopened)),
    )

    expect(nameOf(failed)).toBe('Failed')
    expect(saysCatchingUp(failed)).toBe(false)
    expect(shownOffsets(failed)).toEqual([0, 10])
    expect(failureOf(failed)).toEqual(Option.some(READ_FAILED))
  })

  it('keeps the rows it showed when the read behind them had nothing yet', () => {
    const failed = after(
      [watchFailed(REJECTED), watchResumed(true), watchFailed(READ_FAILED)],
      resumedCurrent,
    )

    expect(nameOf(failed)).toBe('Failed')
    expect(shownOffsets(failed)).toEqual([0])
  })

  it('retries under its own tag, with the failure still up and no words', () => {
    const again = after([watchFailed(READ_FAILED), watchResumed(true)], resumedCurrent)

    expect(isRetrying(again)).toBe(true)
    expect(saysCatchingUp(again)).toBe(false)
    expect(failureOf(again)).toEqual(Option.some(READ_FAILED))
  })

  it('forgets the failure once the watch delivers again', () => {
    const again = after(
      [watchFailed(READ_FAILED), watchResumed(true), eventArrived(NEWER)],
      resumedCurrent,
    )

    expect(nameOf(again)).toBe('Holding')
    expect(failureOf(again)).toEqual(Option.none())
    expect(nameOf(after([eventArrived(caughtUp(20))], again))).toBe('Current')
  })

  it('gives a catch-up that failed no divider later', () => {
    const failed = after(
      [watchResumed(true), eventArrived(NEWER), watchFailed(READ_FAILED)],
      reopened,
    )
    const done = after([watchResumed(true), eventArrived(caughtUp(20))], failed)

    expect(Option.exists(shownOf(done), (view) => LaptopCatchUp.$is('None')(view.catchUp))).toBe(
      true,
    )
  })
})

describe('Show earlier', () => {
  const tail = after([
    watchResumed(true),
    eventArrived(opened()),
    eventArrived(omittedUpTo(SESSION, TAIL_START)),
    eventArrived(chunk(4096, 4106, [said(4096, 'tail')])),
    eventArrived(caughtUp(4106)),
  ])
  const asking = after([EARLIER_ASKED], tail)

  it('keeps the rows, restarts the watch without a tail, and says only that it loads', () => {
    expect(isLoadingEarlier(asking)).toBe(true)
    expect(shownOffsets(asking)).toEqual(shownOffsets(tail))
    expect(commandsAfter([EARLIER_ASKED], tail)).toEqual([TranscriptCommand.ReadAgain()])
    expect(resumeOf(foldOf(asking), Option.some(ANY_TAIL))).toEqual({
      from: Option.none(),
      tail: Option.none(),
    })
    expect(saysCatchingUp(after([noticeDue(attemptOf(asking))], asking))).toBe(false)
  })

  it('drops what the old watch still sends until the new one has started', () => {
    expect(after([eventArrived(chunk(4106, 4116, [said(4106, 'late')]))], asking)).toBe(asking)
  })

  it('does not come back on a later resume', () => {
    const whole = after(
      [
        watchResumed(true),
        eventArrived(opened()),
        eventArrived(chunk(0, 4106, [said(0, 'whole')])),
        eventArrived(caughtUp(4106)),
      ],
      asking,
    )

    expect(nameOf(whole)).toBe('Current')
    expect(isLoadingEarlier(after([watchResumed(true)], whole))).toBe(false)
  })

  it('stops reading whole at the next session, and reads it from its tail again', () => {
    const whole = after(
      [
        watchResumed(true),
        eventArrived(opened()),
        eventArrived(chunk(0, 4106, [said(0, 'whole')])),
        eventArrived(caughtUp(4106)),
      ],
      asking,
    )

    expect(commandsAfter([eventArrived(opened(NEXT_SESSION))], whole)).toEqual([
      TranscriptCommand.ReadAgain(),
    ])

    const moved = after(
      [
        eventArrived(opened(NEXT_SESSION)),
        eventArrived(chunk(0, 10, [said(0, 'read whole by the old watch')], NEXT_SESSION)),
      ],
      whole,
    )

    expect(nameOf(moved)).toBe('NoView')
    expect(foldOf(moved).lines).toEqual([])
    expect(resumeOf(foldOf(moved), Option.some(ANY_TAIL))).toEqual({
      from: Option.none(),
      tail: Option.some(ANY_TAIL),
    })
  })

  it('keeps reading whole through a plain reconnect', () => {
    const whole = after(
      [
        watchResumed(true),
        eventArrived(opened()),
        eventArrived(chunk(0, 4106, [said(0, 'whole')])),
      ],
      asking,
    )

    expect(
      resumeOf(foldOf(after([watchResumed(true)], whole)), Option.some(ANY_TAIL)).tail,
    ).toEqual(Option.none())
  })
})

describe('what reaches the screen', () => {
  it('wakes no one for a read held back behind the same rows', () => {
    const holding = after([watchResumed(true)], reopened)

    expect(sameOnScreen(holding, after([eventArrived(NEWER)], holding))).toBe(true)
  })

  it('wakes the screen for a skill list that arrives behind the same rows', () => {
    const holding = after([watchResumed(true)], reopened)
    const skills = eventArrived(new SkillsChanged({ session: SESSION, skills: [] }))

    expect(sameOnScreen(holding, after([skills], holding))).toBe(false)
  })

  it('wakes the screen when the rows, the tag or the session change', () => {
    const holding = after([watchResumed(true)], reopened)

    expect(sameOnScreen(holding, noticed(holding))).toBe(false)
    expect(sameOnScreen(resumedCurrent, after([eventArrived(NEWER)], resumedCurrent))).toBe(false)
    expect(
      sameOnScreen(
        after([watchResumed(true)]),
        after([watchResumed(true), eventArrived(opened())]),
      ),
    ).toBe(false)
  })
})
