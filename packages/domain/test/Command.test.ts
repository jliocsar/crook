import { describe, expect, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import { AgentRow, agentTitle } from '@crook/domain/AgentRow'
import {
  ClosePane,
  Command,
  InputDelivered,
  RenameAgent,
  SendKeys,
  hasMovedSince,
  interrupt,
  targetPane,
} from '@crook/domain/Command'
import { PaneId, TabId, WorkspaceId } from '@crook/domain/Ids'

const pane = PaneId.make('w1:p1')

const rowAt = (
  rowPane: PaneId,
  stateChangeSeq: number,
  label: Option.Option<string> = Option.none(),
) =>
  new AgentRow({
    pane: rowPane,
    label,
    createdByCrook: false,
    workspace: WorkspaceId.make('w1'),
    tab: TabId.make('w1:t1'),
    status: 'working',
    title: 'EX-253 Example feature',
    cwd: '/home/jliocsar/Projects/crook',
    branch: Option.none(),
    claudeSession: Option.none(),
    stateChangeSeq,
    statusChangedAt: DateTime.makeUnsafe('2026-10-20T15:00:00Z'),
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
  const receipt = new InputDelivered({ pane, stateChangeSeq: 4 })

  it('holds once the pane shows a later state change than the one the agent saw', () => {
    expect(hasMovedSince(receipt, rowAt(pane, 5))).toBe(true)
  })

  it('does not hold while the pane still shows the state the command was sent against', () => {
    expect(hasMovedSince(receipt, rowAt(pane, 4))).toBe(false)
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

describe('agentTitle', () => {
  it('prefers the name the pane was given in herdr over the title Claude sets', () => {
    expect(agentTitle(rowAt(pane, 1))).toBe('EX-253 Example feature')
    expect(agentTitle(rowAt(pane, 1, Option.some('Payments')))).toBe('Payments')
  })
})
