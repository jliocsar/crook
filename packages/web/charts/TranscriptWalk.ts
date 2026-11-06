import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import {
  BackgroundChanged,
  omittedBetween,
  omittedUpTo,
  SkillsChanged,
  TranscriptCaughtUp,
  TranscriptChunk,
  TranscriptOpened,
} from '@crook/domain/Transcript'
import { UserMessage } from '@crook/domain/TranscriptMessage'
import { ClaudeSessionId, TranscriptOffset } from '@crook/domain/Ids'
import { TranscriptReadFailed, TranscriptResumeRejected } from '@crook/protocol/Transcripts'
import {
  attemptOf,
  awaitsOf,
  cacheRead,
  EARLIER_ASKED,
  emptyDue,
  eventArrived,
  foldOf,
  hasFailed,
  isCaughtUp,
  isRestarting,
  noticeDue,
  noticeHeld,
  saysCatchingUp,
  shownOf,
  threadSessionOf,
  TranscriptCommand,
  transcriptMachine,
  TranscriptViewEvent,
  TranscriptViewState,
  watchFailed,
  watchResumed,
} from '@crook/web/chat/TranscriptMachine'
import {
  applyTranscriptEvent,
  EMPTY_TRANSCRIPT,
  hasLines,
  isOpened,
  LaptopCatchUp,
  sessionOf,
} from '@crook/web/chat/TranscriptState'
import type { TranscriptView } from '@crook/web/chat/TranscriptState'
import { caseName } from '@crook/state-machine/Machine'
import type { WalkSpec } from '@crook/state-machine/Walk'

const SESSION_A = ClaudeSessionId.make('session-a')
const SESSION_B = ClaudeSessionId.make('session-b')
const SOME_OFFSET = TranscriptOffset.make(10)
const PAST_A_GAP = TranscriptOffset.make(20)
const READ_FAILED = new TranscriptReadFailed({ detail: 'disk unplugged' })
const REJECTED = new TranscriptResumeRejected({ detail: 'the file shrank' })

const CACHED_VIEW = applyTranscriptEvent(
  applyTranscriptEvent(EMPTY_TRANSCRIPT, new TranscriptOpened({ session: SESSION_A })),
  omittedUpTo(SESSION_A, SOME_OFFSET),
)

const isCaughtUpArrival = (event: TranscriptViewEvent): boolean =>
  TranscriptViewEvent.guards.EventArrived(event) && isCaughtUp(event.event)

const opensAnother = (state: TranscriptViewState, event: TranscriptViewEvent): boolean =>
  TranscriptViewEvent.guards.EventArrived(event) &&
  Schema.is(TranscriptOpened)(event.event) &&
  Option.exists(threadSessionOf(state), (session) => session !== event.event.session)

const isSkipArrival = (event: TranscriptViewEvent): boolean =>
  TranscriptViewEvent.guards.EventArrived(event) &&
  Schema.is(TranscriptChunk)(event.event) &&
  event.event.offset === SOME_OFFSET

const isTimer = TranscriptViewEvent.isAnyOf(['NoticeDue', 'NoticeHeld', 'EmptyDue'])

const shownHasLines = (state: TranscriptViewState): boolean =>
  Option.exists(shownOf(state), hasLines)

const sameSession = (one: TranscriptView, other: TranscriptView): boolean =>
  Option.getOrUndefined(sessionOf(Option.some(one))) ===
  Option.getOrUndefined(sessionOf(Option.some(other)))

const catchUpName = (view: TranscriptView): string =>
  LaptopCatchUp.$match(view.catchUp, {
    None: () => 'none',
    Pending: () => 'pending',
    Landed: () => 'landed',
  })

const shownRelation = (state: TranscriptViewState): string =>
  Option.match(shownOf(state), {
    onNone: () => 'nothing shown',
    onSome: (shown) =>
      [
        hasLines(shown) ? 'rows' : 'no rows',
        Option.isSome(foldOf(state).position) && !sameSession(shown, foldOf(state))
          ? 'of another session'
          : 'of this session',
        catchUpName(shown),
      ].join(' '),
  })

const flagsOf = (state: TranscriptViewState): string =>
  JSON.stringify([
    awaitsOf(state),
    TranscriptViewState.guards.CatchingUp(state) ? state.noticeHeld : false,
    isRestarting(state),
  ])

const saysNoMessages = (state: TranscriptViewState): boolean =>
  !TranscriptViewState.guards.NoView(state) && !hasFailed(state) && !shownHasLines(state)

const waitsOutEmpty = (state: TranscriptViewState): boolean =>
  TranscriptViewState.guards.NoView(state) &&
  !state.awaits &&
  !state.restarting &&
  isOpened(state.fold) &&
  !hasLines(state.fold)

const hasCommand = (
  commands: readonly TranscriptCommand[],
  command: TranscriptCommand['_tag'],
): boolean => commands.some(TranscriptCommand.$is(command))

const here = (state: TranscriptViewState): ClaudeSessionId =>
  Option.getOrElse(threadSessionOf(state), () => SESSION_A)

const elsewhere = (state: TranscriptViewState): ClaudeSessionId =>
  here(state) === SESSION_A ? SESSION_B : SESSION_A

const skipOver = (session: ClaudeSessionId) =>
  eventArrived(omittedBetween(session, SOME_OFFSET, PAST_A_GAP))

const linesOverSameGap = (session: ClaudeSessionId) =>
  eventArrived(
    new TranscriptChunk({
      session,
      offset: SOME_OFFSET,
      nextOffset: PAST_A_GAP,
      messages: [
        new UserMessage({
          offset: SOME_OFFSET,
          uuid: Option.none(),
          timestamp: Option.none(),
          isMeta: false,
          origin: Option.none(),
          queued: false,
          blocks: [],
        }),
      ],
    }),
  )

const identityOf = (state: TranscriptViewState): string =>
  [
    caseName(TranscriptViewState, state),
    Option.isSome(foldOf(state).position) ? 'opened' : 'unopened',
    hasLines(foldOf(state)) ? 'read lines' : 'read nothing',
    foldOf(state).whole ? 'whole' : 'tail',
    catchUpName(foldOf(state)),
    shownRelation(state),
    flagsOf(state),
  ].join(', ')

const landsLikeLines = (
  from: TranscriptViewState,
  to: TranscriptViewState,
  commands: readonly TranscriptCommand[],
): boolean => {
  const [plain, plainCommands] = transcriptMachine.transition(from, linesOverSameGap(here(from)))

  return identityOf(plain) === identityOf(to) && plainCommands.length === commands.length
}

export const transcriptWalk: WalkSpec<TranscriptViewState, TranscriptViewEvent, TranscriptCommand> =
  {
    machine: transcriptMachine,
    events: (state) => [
      cacheRead(Option.some(CACHED_VIEW)),
      cacheRead(Option.none()),
      watchResumed(true),
      watchResumed(false),
      eventArrived(new TranscriptOpened({ session: here(state) })),
      eventArrived(new TranscriptOpened({ session: elsewhere(state) })),
      eventArrived(omittedUpTo(here(state), SOME_OFFSET)),
      skipOver(here(state)),
      eventArrived(new BackgroundChanged({ session: here(state), tasks: [], activity: [] })),
      eventArrived(new SkillsChanged({ session: here(state), skills: [] })),
      eventArrived(new TranscriptCaughtUp({ session: here(state), offset: SOME_OFFSET })),
      watchFailed(READ_FAILED),
      watchFailed(REJECTED),
      EARLIER_ASKED,
      noticeDue(attemptOf(state)),
      noticeDue(attemptOf(state) + 1),
      noticeHeld(attemptOf(state)),
      noticeHeld(attemptOf(state) + 1),
      emptyDue(attemptOf(state)),
      emptyDue(attemptOf(state) + 1),
    ],
    home: TranscriptViewState.guards.Current,
    identity: identityOf,
    commandName: TranscriptCommand.$match({
      WaitOutNotice: () => 'WaitOutNotice',
      HoldNotice: () => 'HoldNotice',
      WaitOutEmpty: () => 'WaitOutEmpty',
      ReadAgain: () => 'ReadAgain',
    }),
    invariants: [
      {
        name: 'never No messages yet while content is known to exist',
        holds: (state) => !saysNoMessages(state) || !hasLines(foldOf(state)),
      },
      {
        name: 'never an old session behind a new one that opened',
        holds: (state) =>
          !shownHasLines(state) ||
          Option.isNone(foldOf(state).position) ||
          Option.exists(shownOf(state), (shown) => sameSession(shown, foldOf(state))),
      },
      {
        name: 'a failure never says it is catching up',
        holds: (state) => !hasFailed(state) || !saysCatchingUp(state),
      },
    ],
    arrowRules: [
      {
        name: 'a chunk that skips a gap lands as a chunk of lines does, with no case of its own',
        holds: ({ from, event, to, commands }) =>
          !isSkipArrival(event) || landsLikeLines(from, to, commands),
      },
      {
        name: 'rows leave only for another session, or a read that ended and found none',
        holds: ({ from, event, to }) =>
          !shownHasLines(from) ||
          shownHasLines(to) ||
          opensAnother(from, event) ||
          isCaughtUpArrival(event),
      },
      {
        name: 'only Show earlier starts loading earlier, so a later resume cannot',
        holds: ({ from, event, to }) =>
          !TranscriptViewState.guards.LoadingEarlier(to) ||
          TranscriptViewState.guards.LoadingEarlier(from) ||
          TranscriptViewEvent.guards.EarlierAsked(event),
      },
      {
        name: 'the words come only after the delay, so a quick read never says anything',
        holds: ({ from, event, to }) =>
          !saysCatchingUp(to) ||
          saysCatchingUp(from) ||
          TranscriptViewEvent.guards.NoticeDue(event),
      },
      {
        name: 'words on screen outlast their hold when the read ends first',
        holds: ({ from, event, to }) =>
          !TranscriptViewState.guards.CatchingUp(from) ||
          from.noticeHeld ||
          !isCaughtUpArrival(event) ||
          saysCatchingUp(to) ||
          !hasLines(foldOf(to)),
      },
      {
        name: 'a finished wait for an old attempt changes nothing',
        holds: ({ from, event, to }) =>
          !isTimer(event) || event.attempt === attemptOf(from) || from === to,
      },
      {
        name: 'what an old watch still sends after a restart changes nothing',
        holds: ({ from, event, to }) =>
          !isRestarting(from) || !TranscriptViewEvent.guards.EventArrived(event) || from === to,
      },
      {
        name: 'a whole read that leaves its session reads the next one from its tail',
        holds: ({ from, event, to, commands }) =>
          !foldOf(from).whole ||
          isRestarting(from) ||
          !opensAnother(from, event) ||
          (!foldOf(to).whole && hasCommand(commands, 'ReadAgain')),
      },
      {
        name: 'a catch-up lands only from a reopened cache, once the read has ended',
        holds: ({ from, event, to }) =>
          !LaptopCatchUp.$is('Landed')(foldOf(to).catchUp) ||
          LaptopCatchUp.$is('Landed')(foldOf(from).catchUp) ||
          (LaptopCatchUp.$is('Pending')(foldOf(from).catchUp) && isCaughtUpArrival(event)),
      },
      {
        name: 'a resume that holds rows back starts the wait that ends in words',
        holds: ({ event, to, commands }) =>
          !TranscriptViewEvent.guards.WatchResumed(event) ||
          !TranscriptViewState.guards.Holding(to) ||
          !to.awaits ||
          hasCommand(commands, 'WaitOutNotice'),
      },
      {
        name: 'silence from an agent too old for marks starts the wait that ends it',
        holds: ({ from, to, commands }) =>
          !waitsOutEmpty(to) || waitsOutEmpty(from) || hasCommand(commands, 'WaitOutEmpty'),
      },
    ],
  }
