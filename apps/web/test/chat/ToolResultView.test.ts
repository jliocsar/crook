import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'

import { TextBlock, ToolResultBlock } from '@crook/domain/TranscriptMessage'
import {
  approvalMessage,
  resultStatus,
  toolFields,
  ToolResultView,
  toolResultView,
} from '@crook/web/chat/ToolResultView'

const CODE_MODE = 'mcp__codemode__run'

const result = (text: string, isError = false) =>
  new ToolResultBlock({
    toolUseId: 'toolu_1',
    isError,
    content: [new TextBlock({ text })],
    patch: Option.none(),
    subagent: Option.none(),
    task: Option.none(),
  })

const APPROVAL = JSON.stringify({
  status: 'approval-required',
  elicitation: { mode: 'form', message: 'Create it?', requestedSchema: { properties: {} } },
})

const called = (name: string, text: string) => ({
  name,
  input: {},
  result: Option.some(result(text)),
})

describe('toolFields', () => {
  it('gives code mode its code as TypeScript and each input under the name the code reads', () => {
    expect(
      toolFields(CODE_MODE, { code: 'return inputs.body', inputs: { body: 'words', count: 2 } }),
    ).toEqual([
      {
        key: 'code',
        label: 'code',
        text: 'return inputs.body',
        language: Option.some('typescript'),
      },
      { key: 'inputs.body', label: 'inputs.body', text: 'words', language: Option.none() },
      { key: 'inputs.count', label: 'inputs.count', text: '2', language: Option.none() },
    ])
  })

  it('labels any tool in words, with structured values as JSON and none of it as one blob', () => {
    expect(
      toolFields('Unheard', { to_whom: 'reviewer', scriptPath: 'a.js', nested: { a: 1 } }),
    ).toEqual([
      { key: 'to_whom', label: 'to whom', text: 'reviewer', language: Option.none() },
      { key: 'scriptPath', label: 'script path', text: 'a.js', language: Option.none() },
      { key: 'nested', label: 'nested', text: '{\n  "a": 1\n}', language: Option.some('json') },
    ])
  })

  it('highlights the fields that hold a program, and only for the tools that run one', () => {
    expect(toolFields('Monitor', { command: 'tail -f a' })[0]?.language).toEqual(
      Option.some('shellscript'),
    )
    expect(toolFields('mcp__executor__execute', { code: 'return 1' })[0]?.language).toEqual(
      Option.some('javascript'),
    )
    expect(toolFields('mcp__posthog__exec', { code: 'return 1' })[0]?.language).toEqual(
      Option.none(),
    )
  })

  it('has nothing to show for an input that is not a record', () => {
    expect(toolFields(CODE_MODE, 'raw')).toEqual([])
  })
})

describe('resultStatus', () => {
  it('reads a code mode run that says it failed, though its result is not an error', () => {
    expect(resultStatus(CODE_MODE, result('run failed: no such file'))).toBe('error')
    expect(resultStatus(CODE_MODE, result('12 checks, none run failed: all good'))).toBe('success')
    expect(resultStatus(CODE_MODE, result('fine'))).toBe('success')
  })

  it('leaves those words to code mode alone, and always takes an error at its word', () => {
    expect(resultStatus('Bash', result('run failed: not us'))).toBe('success')
    expect(resultStatus('Bash', result('fine', true))).toBe('error')
  })

  it('does not call a call done that stopped to ask, since it has not run', () => {
    expect(resultStatus('mcp__executor__call', result(APPROVAL))).toBe('stopped')
    expect(resultStatus(CODE_MODE, result(APPROVAL))).toBe('success')
  })
})

describe('approvalMessage', () => {
  it('reads the question of an executor call', () => {
    expect(approvalMessage(called('mcp__executor__call', APPROVAL))).toEqual(
      Option.some('Create it?'),
    )
  })

  it('takes no other tool or result for one', () => {
    expect(approvalMessage(called(CODE_MODE, APPROVAL))).toEqual(Option.none())
    expect(approvalMessage(called('mcp__executor__call', 'approval-required'))).toEqual(
      Option.none(),
    )
    expect(approvalMessage(called('mcp__executor__call', '{"status":"done"}'))).toEqual(
      Option.none(),
    )
  })
})

describe('toolResultView', () => {
  it('sets out a JSON result and leaves any other text as it is', () => {
    expect(toolResultView(called(CODE_MODE, '{"a":1}'))).toEqual(
      Option.some(ToolResultView.Structured({ text: '{\n  "a": 1\n}' })),
    )
    expect(toolResultView(called(CODE_MODE, '[not json'))).toEqual(
      Option.some(ToolResultView.Words({ text: '[not json' })),
    )
    expect(toolResultView(called(CODE_MODE, '12'))).toEqual(
      Option.some(ToolResultView.Words({ text: '12' })),
    )
  })

  it('reads what SendMessage answered rather than its envelope', () => {
    expect(
      toolResultView(called('SendMessage', '{"success":true,"message":"Delivered.","msg_id":"m"}')),
    ).toEqual(Option.some(ToolResultView.Words({ text: 'Delivered.' })))
  })

  it('shows nothing for no text and nothing beside an approval, which reads on its own', () => {
    expect(toolResultView(called(CODE_MODE, '   '))).toEqual(Option.none())
    expect(toolResultView(called('mcp__executor__call', APPROVAL))).toEqual(Option.none())
    expect(toolResultView({ name: CODE_MODE, input: {}, result: Option.none() })).toEqual(
      Option.none(),
    )
  })
})
