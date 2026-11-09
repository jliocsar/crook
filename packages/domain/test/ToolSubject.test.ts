import { describe, expect, it } from '@effect/vitest'
import * as Option from 'effect/Option'

import { toolSubject } from '@crook/domain/ToolSubject'

const CODE_MODE = 'mcp__codemode__run'

describe('toolSubject', () => {
  it('names the tools a code mode call reaches, once each, in words', () => {
    const code = [
      "await tools.call('Bash', { command: 'ls' })",
      'await tools.call("Read", {})',
      'await tools.call(`Bash`, {})',
      "await tools.call(\n  'mcp__linear__get_issue',\n  {},\n)",
    ].join('\n')

    expect(toolSubject(CODE_MODE, { code })).toEqual(
      Option.some('Bash, Read, get issue from linear'),
    )
  })

  it('falls back to the first line of a call that names no tool', () => {
    expect(toolSubject(CODE_MODE, { code: 'return 1\nreturn 2' })).toEqual(Option.some('return 1'))
    expect(toolSubject(CODE_MODE, { code: 'tools.call(name, {})' })).toEqual(
      Option.some('tools.call(name, {})'),
    )
  })

  it('reads what a tool without a field of its own would have buried', () => {
    expect(toolSubject('Monitor', { command: 'tail -f a', description: 'Watch the log' })).toEqual(
      Option.some('Watch the log'),
    )
    expect(
      toolSubject('SendMessage', { type: 'message', to: 'reviewer', message: 'Read it' }),
    ).toEqual(Option.some('reviewer'))
    expect(toolSubject('mcp__executor__resume', { executionId: 'e1', action: 'accept' })).toEqual(
      Option.some('accept'),
    )
  })

  it('still reads an unknown tool by its first string field', () => {
    expect(toolSubject('Unheard', { count: 1, name: 'first' })).toEqual(Option.some('first'))
    expect(toolSubject('Unheard', { count: 1 })).toEqual(Option.none())
  })
})
