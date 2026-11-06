import { fireEvent, render, screen } from '@testing-library/react'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import { describe, expect, it } from 'vitest'

import { TextBlock, ToolResultBlock } from '@crook/domain/TranscriptMessage'
import { ChatItem, ToolCallModel } from '@crook/web/chat/ChatItems'
import { ThreadItem, type ThreadEnvironment } from '@crook/web/chat/ThreadItem'
import { toolSummary } from '@crook/web/chat/ToolSummary'
import { RowMemoryScope } from '@crook/web/components/RowMemory'

const CWD = '/home/ada/Projects/herd'

const ENVIRONMENT: ThreadEnvironment = {
  cwd: CWD,
  paneClosed: false,
  onShowEarlier: () => undefined,
  earlierPending: false,
  onOpenRun: Option.none(),
}

const toolItem = (
  name: string,
  input: ConstructorParameters<typeof ToolCallModel>[0]['input'],
  text: string,
  status: 'success' | 'error' | 'stopped' = 'success',
) =>
  ChatItem.Tool({
    key: 'row',
    call: new ToolCallModel({
      id: 'toolu_1',
      name,
      summary: toolSummary(name, input, CWD),
      input,
      status,
      result: Option.some(
        new ToolResultBlock({
          toolUseId: 'toolu_1',
          isError: false,
          content: [new TextBlock({ text })],
          patch: Option.none(),
          subagent: Option.none(),
          task: Option.none(),
        }),
      ),
      startedAt: Option.none(),
      finishedAt: Option.none(),
    }),
  })

const openRow = (item: ReturnType<typeof toolItem>) => {
  const store = new Map([['row tool-call', true]])

  return render(
    <RowMemoryScope store={store} rowKey="row">
      <ThreadItem item={item} environment={ENVIRONMENT} />
    </RowMemoryScope>,
  )
}

describe('a tool row', () => {
  it('reads code mode in words, its code and its result apart, and no JSON of its input', () => {
    const { container } = openRow(
      toolItem('mcp__codemode__run', { code: "await tools.call('Bash', {})" }, 'all good'),
    )

    expect(screen.getByText('code mode(Bash)')).toBeTruthy()
    expect(container.querySelector('[data-slot="code-block"]')?.textContent).toContain(
      "await tools.call('Bash', {})",
    )
    expect(container.querySelector('[data-slot="folded-output"]')?.textContent).toBe('all good')
    expect(container.textContent).not.toContain('"code"')
    expect(container.textContent).not.toContain('mcp__')
  })

  it('folds a long result and a long program to what a screen can take', () => {
    const code = Arr.makeBy(30, (index) => `const v${index} = ${index}`).join('\n')
    const output = Arr.makeBy(200, (index) => `line ${index}`).join('\n')

    const { container } = openRow(toolItem('mcp__codemode__run', { code }, output))

    expect(screen.getByText('Show 20 more lines')).toBeTruthy()
    expect(screen.getByText('Show 188 more lines')).toBeTruthy()
    expect(container.textContent).not.toContain('const v29')
    expect(container.textContent).not.toContain('line 199')
  })

  it('folds one very long line, which counts as no lines at all', () => {
    const { container } = openRow(
      toolItem('mcp__codemode__run', { code: 'return 1' }, 'x'.repeat(5000)),
    )

    expect(screen.getByText('Show all')).toBeTruthy()
    expect(container.querySelector('[data-slot="folded-output"] pre')?.textContent).toHaveLength(
      600,
    )
  })

  it('shows a failed run in the colour of a failure', () => {
    const { container } = openRow(
      toolItem('mcp__codemode__run', { code: 'return 1' }, 'run failed: nope', 'error'),
    )

    expect(container.querySelector('[data-slot="folded-output"] pre')?.className).toContain(
      'text-destructive',
    )
  })

  it('reads an approval an executor call asked for, and offers nothing to answer it with', () => {
    const { container } = openRow(
      toolItem(
        'mcp__executor__call',
        { calls: [{ path: 'tools.linear.createIssue' }] },
        JSON.stringify({
          status: 'approval-required',
          requestId: 'request_1',
          elicitation: { mode: 'form', message: 'Create it?', requestedSchema: { properties: {} } },
        }),
        'stopped',
      ),
    )

    expect(screen.getByText('call from executor(asked for approval)')).toBeTruthy()
    expect(screen.getByText('Create it?')).toBeTruthy()
    expect(container.textContent).not.toContain('request_1')

    const buttons = Array.from(container.querySelectorAll('button')).map(
      (button) => button.getAttribute('aria-label') ?? button.textContent,
    )

    expect(buttons).toEqual(['call from executor(asked for approval)stopped', 'Copy code'])
  })

  it('keeps the failure colour on a failed call whose result is JSON', () => {
    const { container } = openRow(
      toolItem('mcp__notion__notion_fetch', { page_id: 'p1' }, '{"error":"nope"}', 'error'),
    )

    const outputs = Array.from(container.querySelectorAll('[data-slot="folded-output"] pre'))

    expect(outputs.at(-1)?.className).toContain('text-destructive')
  })

  it('keeps an input named result apart from the result when one is unfolded', () => {
    const { container } = openRow(
      toolItem(
        'mcp__notion__notion_fetch',
        { result: { list: Arr.makeBy(30, (index) => index) } },
        '{"rows":[1,2,3,4,5,6,7,8,9,10,11,12]}',
      ),
    )

    const toggles = screen.getAllByRole('button', { name: /more lines/u })

    expect(toggles).toHaveLength(2)

    fireEvent.click(toggles[0]!)

    expect(screen.getAllByRole('button', { name: /more lines/u })).toHaveLength(1)
    expect(container.textContent).toContain('Show less')
  })

  it('reads a tool crook has no view for by its fields, in words', () => {
    const { container } = openRow(
      toolItem('mcp__notion__notion_fetch', { page_id: 'p1', depth: 2 }, 'A page.'),
    )

    expect(screen.getByText('notion fetch from notion(p1)')).toBeTruthy()
    expect(screen.getByText('page id')).toBeTruthy()
    expect(screen.getByText('depth')).toBeTruthy()
    expect(container.textContent).not.toContain('{')
  })
})
