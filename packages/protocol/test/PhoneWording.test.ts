import { describe, expect, it } from '@effect/vitest'
import * as Duration from 'effect/Duration'
import * as Option from 'effect/Option'

import { AskId, ClaudeSessionId, MachineId, PaneId } from '@crook/domain/Ids'
import { HubStorageFailed, PaneNotInHerd } from '@crook/protocol/ClientApi'
import {
  AgentNotStarted,
  AskDialogUnreadable,
  AskNotPending,
  AskOptionUnavailable,
  CommandTimedOut,
  DeclineMessageUndelivered,
  FolderUnreadable,
  HerdrAnswerUnreadable,
  HerdrRefusedCommand,
  PaneNotAgent,
  PaneNotCreatedByCrook,
  QuestionnaireUnsupported,
  TaskNotDelivered,
  claudeWaitingRefusal,
  commandFailureForTheLog,
} from '@crook/protocol/Commands'
import {
  HarkAnswerUnreadable,
  HarkNotConfigured,
  HarkRefused,
  HarkServerFailed,
  HarkStillProcessing,
  HarkUnreachable,
  NO_TOKEN_SETUP,
  harkFailureForTheLog,
} from '@crook/protocol/Hark'
import {
  TranscriptReadFailed,
  TranscriptResumeRejected,
  TranscriptSessionRejected,
} from '@crook/protocol/Transcripts'

const PANE = PaneId.make('w1:p1')
const ASK = AskId.make('toolu_ask')
const MACHINE = MachineId.make('laptop')
const SESSION = ClaudeSessionId.make('raw-session')
const HARK_SAID = 'raw words of hark'
const RAW_CODE = 'raw_code'
const RAW_DETAIL = 'raw detail'
const TOKEN_VARIABLE = 'CROOK_HUB_HARK_TOKEN'

const WORDS_THE_PHONE_NEVER_SHOWS =
  /w1:p1|toolu_ask|idempotency|CROOK_|disk full|raw_code|raw detail|raw words of hark|raw-session|status \d/u

const FAILURES_THE_PHONE_SHOWS = [
  new PaneNotInHerd({ machine: MACHINE, pane: PANE }),
  new HubStorageFailed({ detail: 'disk full' }),
  new PaneNotAgent({ pane: PANE }),
  new PaneNotCreatedByCrook({ pane: PANE }),
  new AskNotPending({ pane: PANE, ask: ASK }),
  new AskDialogUnreadable({ pane: PANE }),
  new AskOptionUnavailable({ pane: PANE, option: 'yes' }),
  new QuestionnaireUnsupported({ pane: PANE }),
  new DeclineMessageUndelivered({ pane: PANE, reason: RAW_DETAIL }),
  new TaskNotDelivered({ pane: PANE, code: RAW_CODE, detail: RAW_DETAIL }),
  new CommandTimedOut({ machine: MACHINE, timeout: Duration.seconds(30) }),
  new HerdrRefusedCommand({ code: RAW_CODE, detail: RAW_DETAIL }),
  new HerdrAnswerUnreadable({ method: RAW_CODE, issue: RAW_DETAIL }),
  new FolderUnreadable({ folder: '/home/me/crook', reason: RAW_DETAIL }),
  new AgentNotStarted({
    folder: '/home/me/crook',
    worktree: Option.none(),
    code: RAW_CODE,
    detail: RAW_DETAIL,
  }),
  new HarkNotConfigured(),
  new HarkRefused({ status: 401, explanation: Option.some(HARK_SAID) }),
  new HarkRefused({ status: 403, explanation: Option.none() }),
  new HarkRefused({ status: 500, explanation: Option.none() }),
  new HarkServerFailed({ status: 503, explanation: Option.some(HARK_SAID) }),
  new HarkStillProcessing(),
  new HarkUnreachable({ detail: RAW_DETAIL }),
  new HarkAnswerUnreadable({ detail: RAW_DETAIL }),
  new TranscriptReadFailed({ detail: RAW_DETAIL }),
  new TranscriptResumeRejected({ detail: RAW_DETAIL }),
  new TranscriptSessionRejected({ session: SESSION }),
]

describe('a failure the phone shows', () => {
  it('names no pane id, ask id, key, environment variable or raw detail', () => {
    for (const failure of FAILURES_THE_PHONE_SHOWS) {
      expect(failure.message).not.toMatch(WORDS_THE_PHONE_NEVER_SHOWS)
    }
  })

  it('keeps on the wire what its words leave out', () => {
    expect(new HubStorageFailed({ detail: 'disk full' }).detail).toBe('disk full')
    expect(new AskNotPending({ pane: PANE, ask: ASK }).pane).toBe(PANE)
    expect(new TranscriptReadFailed({ detail: RAW_DETAIL }).detail).toBe(RAW_DETAIL)
  })
})

describe('what the operator reads instead', () => {
  it('names what the agent left out of a command failure', () => {
    expect(
      commandFailureForTheLog(new HerdrRefusedCommand({ code: RAW_CODE, detail: RAW_DETAIL })),
    ).toEqual(Option.some(expect.stringMatching(/raw_code.*raw detail/u)))
    expect(
      commandFailureForTheLog(new DeclineMessageUndelivered({ pane: PANE, reason: RAW_DETAIL })),
    ).toEqual(Option.some(expect.stringContaining(RAW_DETAIL)))
    expect(
      commandFailureForTheLog(new HerdrAnswerUnreadable({ method: RAW_CODE, issue: RAW_DETAIL })),
    ).toEqual(Option.some(expect.stringMatching(/raw_code.*raw detail/u)))
    expect(
      commandFailureForTheLog(
        new FolderUnreadable({ folder: '/home/me/crook', reason: RAW_DETAIL }),
      ),
    ).toEqual(Option.some(expect.stringContaining(RAW_DETAIL)))
    expect(commandFailureForTheLog(new PaneNotAgent({ pane: PANE }))).toEqual(Option.none())
    expect(commandFailureForTheLog(claudeWaitingRefusal())).toEqual(Option.none())
  })

  it('names the setting and what Hark said in the hub log', () => {
    expect(harkFailureForTheLog(new HarkNotConfigured())).toBe(NO_TOKEN_SETUP)
    expect(NO_TOKEN_SETUP).toContain(TOKEN_VARIABLE)

    const refused = harkFailureForTheLog(
      new HarkRefused({ status: 401, explanation: Option.some(HARK_SAID) }),
    )

    expect(refused).toContain('401')
    expect(refused).toContain(HARK_SAID)
    expect(refused).toContain(TOKEN_VARIABLE)
    expect(
      harkFailureForTheLog(new HarkRefused({ status: 404, explanation: Option.none() })),
    ).not.toContain(TOKEN_VARIABLE)
    expect(
      harkFailureForTheLog(new HarkServerFailed({ status: 503, explanation: Option.none() })),
    ).toContain('503')
    expect(harkFailureForTheLog(new HarkUnreachable({ detail: RAW_DETAIL }))).toContain(RAW_DETAIL)
    expect(harkFailureForTheLog(new HarkAnswerUnreadable({ detail: RAW_DETAIL }))).toContain(
      RAW_DETAIL,
    )
  })
})
