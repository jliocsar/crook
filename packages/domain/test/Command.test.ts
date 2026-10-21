import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import { AgentRow, agentTitle } from '@crook/domain/AgentRow'
import {
  AgentStarted,
  ClosePane,
  Command,
  CreateWorktree,
  InputDelivered,
  RenameAgent,
  SendKeys,
  StartAgent,
  hasMovedSince,
  hasStarted,
  interrupt,
  targetPane,
} from '@crook/domain/Command'
import { PaneId, TabId, TerminalId, WorkspaceId } from '@crook/domain/Ids'

const pane = PaneId.make('w1:p1')
const terminal = TerminalId.make('term_65e4959ec32112')
const terminalAfterHandoff = TerminalId.make('term_65e4981ac9ff02')

const rowAt = (
  rowPane: PaneId,
  stateChangeSeq: number,
  rowTerminal: TerminalId = terminal,
  label: Option.Option<string> = Option.none(),
) =>
  new AgentRow({
    pane: rowPane,
    label,
    createdByCrook: false,
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    terminal: rowTerminal,
    status: 'working',
    title: 'EX-253 Example feature',
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq,
    statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
    beforeHandoff: Option.none(),
  })

describe('Command', () => {
  it('decodes a prompt and a key press from the wire', () => {
    const decode = Schema.decodeUnknownSync(Command)

    expect(decode({ _tag: 'Prompt', pane: 'w1:p1', text: 'continue' })).toEqual(
      expect.objectContaining({ text: 'continue' }),
    )
    expect(decode({ _tag: 'SendKeys', pane: 'w1:p1', keys: ['esc'] })).toEqual(interrupt(pane))
  })

  it('rejects an empty prompt and a key press with no keys', () => {
    const decode = Schema.decodeUnknownResult(Command)

    expect(Result.isFailure(decode({ _tag: 'Prompt', pane: 'w1:p1', text: '' }))).toBe(true)
    expect(Result.isFailure(decode({ _tag: 'SendKeys', pane: 'w1:p1', keys: [] }))).toBe(true)
  })

  it('interrupts with the esc key herdr names canonically', () => {
    expect(interrupt(pane)).toEqual(new SendKeys({ pane, keys: ['esc'] }))
  })
})

describe('hasMovedSince', () => {
  const receipt = new InputDelivered({ pane, terminal, stateChangeSeq: 4 })

  it('holds once the pane shows a later state change than the one the agent saw', () => {
    expect(hasMovedSince(receipt, rowAt(pane, 5))).toBe(true)
  })

  it('does not hold while the pane still shows the state the command was sent against', () => {
    expect(hasMovedSince(receipt, rowAt(pane, 4))).toBe(false)
  })

  it('holds once herdr restarted the pane under a new terminal, whatever its sequence', () => {
    expect(hasMovedSince(receipt, rowAt(pane, 0, terminalAfterHandoff))).toBe(true)
  })

  it('does not hold for another pane', () => {
    expect(hasMovedSince(receipt, rowAt(PaneId.make('w1:p2'), 9))).toBe(false)
  })
})

describe('rename and close', () => {
  it('decodes a rename that clears the name and a close that carries its confirmation', () => {
    const decode = Schema.decodeUnknownSync(Command)

    expect(decode({ _tag: 'RenameAgent', pane: 'w1:p1', label: null })).toEqual(
      new RenameAgent({ pane, label: Option.none() }),
    )
    expect(decode({ _tag: 'ClosePane', pane: 'w1:p1', confirmed: false })).toEqual(
      new ClosePane({ pane, confirmed: false }),
    )
  })

  it('rejects a blank, padded or control-character name: clearing one is an absent label', () => {
    const decode = Schema.decodeUnknownResult(Command)
    const renamedTo = (label: string) => decode({ _tag: 'RenameAgent', pane: 'w1:p1', label })

    expect(Result.isFailure(renamedTo(''))).toBe(true)
    expect(Result.isFailure(renamedTo('   '))).toBe(true)
    expect(Result.isFailure(renamedTo(' Payments'))).toBe(true)
    expect(Result.isFailure(renamedTo('Pay\u001b[2Jments'))).toBe(true)
    expect(Result.isSuccess(renamedTo('Payments · 🐑'))).toBe(true)
  })

  it('targets the pane every command names', () => {
    expect(targetPane(new RenameAgent({ pane, label: Option.some('Herd') }))).toBe(pane)
    expect(targetPane(new ClosePane({ pane, confirmed: true }))).toBe(pane)
  })
})

describe('starting an agent', () => {
  const decode = Schema.decodeUnknownResult(Command)

  it('decodes a start with or without a task, and a worktree with its branch', () => {
    expect(
      Schema.decodeSync(Command)({
        _tag: 'StartAgent',
        kind: 'claude',
        folder: '/home/jliocsar/Projects/crook',
        task: null,
      }),
    ).toEqual(
      new StartAgent({
        kind: 'claude',
        folder: '/home/jliocsar/Projects/crook',
        task: Option.none(),
      }),
    )
    expect(
      Schema.decodeSync(Command)({
        _tag: 'CreateWorktree',
        kind: 'claude',
        folder: '/home/jliocsar/Projects/crook',
        branch: 'feat/jc-111-new-agent',
        task: 'add the new agent sheet',
      }),
    ).toEqual(
      new CreateWorktree({
        kind: 'claude',
        folder: '/home/jliocsar/Projects/crook',
        branch: 'feat/jc-111-new-agent',
        task: Option.some('add the new agent sheet'),
      }),
    )
  })

  it('rejects a relative folder, an agent other than Claude, an empty task and a branch with a space', () => {
    const startIn = (folder: string) =>
      decode({ _tag: 'StartAgent', kind: 'claude', folder, task: null })

    expect(Result.isFailure(startIn('Projects/crook'))).toBe(true)
    expect(Result.isFailure(startIn('/home/jliocsar/\u001b[2J'))).toBe(true)
    expect(
      Result.isFailure(decode({ _tag: 'StartAgent', kind: 'codex', folder: '/tmp', task: null })),
    ).toBe(true)
    expect(
      Result.isFailure(decode({ _tag: 'StartAgent', kind: 'claude', folder: '/tmp', task: '' })),
    ).toBe(true)
    expect(
      Result.isFailure(
        decode({
          _tag: 'CreateWorktree',
          kind: 'claude',
          folder: '/home/jliocsar/Projects/crook',
          branch: 'new agent',
          task: null,
        }),
      ),
    ).toBe(true)
  })

  it('holds once the pane it started shows up among the agents', () => {
    const started = new AgentStarted({ pane: PaneId.make('w1:p2') })

    expect(hasStarted(started, [rowAt(pane, 1), rowAt(PaneId.make('w1:p2'), 1)])).toBe(true)
    expect(hasStarted(started, [rowAt(pane, 1)])).toBe(false)
  })
})

describe('agentTitle', () => {
  it('prefers the name the pane was given in herdr over the title Claude sets', () => {
    expect(agentTitle(rowAt(pane, 1))).toBe('EX-253 Example feature')
    expect(agentTitle(rowAt(pane, 1, terminal, Option.some('Payments')))).toBe('Payments')
  })
})
