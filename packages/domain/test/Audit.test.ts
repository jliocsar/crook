import { describe, expect, it } from '@effect/vitest'
import * as Exit from 'effect/Exit'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import {
  AuditArguments,
  AuditPolicy,
  DEFECT,
  REDACTED,
  TRUNCATION_MARK,
  applyAuditPolicy,
  auditExit,
  commandAudit,
} from '@crook/domain/Audit'
import {
  AnswerAsk,
  Approve,
  ApproveAlways,
  Choose,
  ClosePane,
  Decline,
  Prompt,
  RenameAgent,
  SendKeys,
} from '@crook/domain/Command'
import { AskId, PaneId } from '@crook/domain/Ids'

const pane = PaneId.make('w1:p1')

class AgentGone extends Schema.TaggedError<AgentGone>()('AgentGone', {}) {
  override get message(): string {
    return 'The agent went away before the test could reach it.'
  }
}

const keepEverything = new AuditPolicy({ argumentLimit: 200, redactedArguments: [] })

describe('commandAudit', () => {
  it('names every command and lists its arguments', () => {
    expect(commandAudit(new Prompt({ pane, text: 'continue' }))).toEqual({
      operation: 'Prompt',
      arguments: { pane: 'w1:p1', text: 'continue' },
    })
    expect(commandAudit(new SendKeys({ pane, keys: ['esc'] }))).toEqual({
      operation: 'SendKeys',
      arguments: { pane: 'w1:p1', keys: ['esc'] },
    })
    expect(commandAudit(new RenameAgent({ pane, label: Option.none() }))).toEqual({
      operation: 'RenameAgent',
      arguments: { pane: 'w1:p1', label: null },
    })
    expect(commandAudit(new ClosePane({ pane, confirmed: true }))).toEqual({
      operation: 'ClosePane',
      arguments: { pane: 'w1:p1', confirmed: true },
    })
  })

  it('records which answer an ask got, keeping a decline message as text', () => {
    const ask = AskId.make('toolu_01XXC3')
    const answered = (answer: AnswerAsk['answer']) =>
      commandAudit(new AnswerAsk({ pane, ask, answer })).arguments

    expect(answered(new Approve({}))).toEqual({ pane, ask, answer: 'Approve' })
    expect(answered(new ApproveAlways({}))).toEqual({ pane, ask, answer: 'ApproveAlways' })
    expect(answered(new Decline({ message: Option.none() }))).toEqual({
      pane,
      ask,
      answer: 'Decline',
      text: null,
    })
    expect(answered(new Choose({ answer: 'Green' }))).toEqual({
      pane,
      ask,
      answer: 'Choose',
      choice: 'Green',
    })
  })

  it('gives arguments that are JSON-safe as they are', () => {
    const { arguments: recorded } = commandAudit(new SendKeys({ pane, keys: ['esc', 'enter'] }))

    expect(
      Schema.decodeSync(Schema.fromJsonString(AuditArguments))(JSON.stringify(recorded)),
    ).toEqual(recorded)
  })
})

describe('applyAuditPolicy', () => {
  it('cuts every argument past the limit, counting characters rather than UTF-16 units', () => {
    const policy = new AuditPolicy({ argumentLimit: 3, redactedArguments: [] })

    expect(
      applyAuditPolicy(policy)({
        text: '🐑🐑🐑🐑',
        keys: ['esc', 'enter'],
        confirmed: false,
        label: null,
      }),
    ).toEqual({
      text: `🐑🐑🐑${TRUNCATION_MARK}`,
      keys: [`esc${TRUNCATION_MARK}`],
      confirmed: false,
      label: null,
    })
  })

  it('spends one limit across the texts of an array, marking the last text it kept', () => {
    const policy = new AuditPolicy({ argumentLimit: 5, redactedArguments: [] })

    expect(applyAuditPolicy(policy)({ keys: ['abc', 'defgh', 'ij'] })).toEqual({
      keys: ['abc', `de${TRUNCATION_MARK}`],
    })
    expect(applyAuditPolicy(policy)({ keys: ['ab', 'cde'] })).toEqual({ keys: ['ab', 'cde'] })
  })

  it('replaces a redacted argument whole, whatever its value', () => {
    const policy = new AuditPolicy({ argumentLimit: 200, redactedArguments: ['text', 'keys'] })

    expect(
      applyAuditPolicy(policy)({ pane: 'w1:p1', text: 'my token is hunter2', keys: ['esc'] }),
    ).toEqual({ pane: 'w1:p1', text: REDACTED, keys: REDACTED })
  })

  it('leaves arguments within the limit untouched', () => {
    expect(applyAuditPolicy(keepEverything)({ pane: 'w1:p1', text: 'continue' })).toEqual({
      pane: 'w1:p1',
      text: 'continue',
    })
  })
})

describe('auditExit', () => {
  it('records a success, a typed failure by its name, a defect and an interruption', () => {
    expect(auditExit(Exit.succeed(1))).toEqual({ outcome: 'succeeded', failure: Option.none() })
    expect(auditExit(Exit.fail(new AgentGone()))).toEqual({
      outcome: 'failed',
      failure: Option.some('AgentGone'),
    })
    expect(auditExit(Exit.die('boom'))).toEqual({ outcome: 'failed', failure: Option.some(DEFECT) })
    expect(auditExit(Exit.interrupt(1))).toEqual({ outcome: 'interrupted', failure: Option.none() })
  })
})
