import { describe, expect, it } from '@effect/vitest'

import { toolName } from '@crook/domain/ToolName'

describe('toolName', () => {
  it('reads an MCP tool as its name and its server, and leaves any other tool alone', () => {
    expect(toolName('mcp__plannotator__send_message')).toBe('send message from plannotator')
    expect(toolName('mcp__claude_ai_Claude_Docs__batch')).toBe('batch from claude ai Claude Docs')
    expect(toolName('mcp__plugin_paper-desktop_paper__get_guide')).toBe('get guide from paper')
    expect(toolName('mcp__plannotator__send__message')).toBe('send message from plannotator')
    expect(toolName('WebFetch')).toBe('WebFetch')
  })

  it('calls the tool that runs code mode by that name, and no other tool of its server', () => {
    expect(toolName('mcp__codemode__run')).toBe('code mode')
    expect(toolName('mcp__codemode__list')).toBe('list from codemode')
  })
})
