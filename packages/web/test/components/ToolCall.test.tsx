import { render } from '@testing-library/react'
import * as Option from 'effect/Option'
import { describe, expect, it } from 'vitest'

import { ToolCall } from '@crook/web/components/ui/tool-call'

const toolCall = (footer: Option.Option<string>) => (
  <ToolCall name="Read" status="success" icon={null} panel={null} footer={footer} />
)

const footerOf = (container: HTMLElement) =>
  container.querySelector('[data-slot="tool-call-footer"]')

describe('ToolCall', () => {
  it('leaves no footer space under a call with nothing to show there', () => {
    const { container } = render(toolCall(Option.none()))

    expect(footerOf(container)).toBeNull()
  })

  it('shows the footer when it has something', () => {
    const { container } = render(toolCall(Option.some('two pictures')))

    expect(footerOf(container)?.textContent).toBe('two pictures')
  })
})
