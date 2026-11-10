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
  it('leaves the spinner to the Working row while it runs', () => {
    const { container } = render(
      <ToolCall name="Read" status="running" icon={null} panel={null} footer={Option.none()} />,
    )

    expect(container.querySelector('[data-slot="spinner"]')).toBeNull()
    expect(container.querySelector('[data-slot="spinner-slot"]')).toBeNull()
  })

  it('leaves no footer space under a call with nothing to show there', () => {
    const { container } = render(toolCall(Option.none()))

    expect(footerOf(container)).toBeNull()
  })

  it('shows the footer when it has something', () => {
    const { container } = render(toolCall(Option.some('two pictures')))

    expect(footerOf(container)?.textContent).toBe('two pictures')
  })
})
